import { z } from "zod";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PinInput = z.object({
  handle: z
    .string()
    .min(1)
    .max(15)
    .regex(/^[A-Za-z0-9_]+$/, "Twitter handle must be alphanumeric/underscore."),
  nextId: z.number().int().min(1).max(666),
  minter: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address."),
  imageBase64: z.string().min(1, "Missing image data."),
  imageMime: z.enum(["image/jpeg", "image/png"]),
});

type PinInputData = z.infer<typeof PinInput>;

export type PinResult = {
  tokenURI: string;
  imageGatewayUrl: string;
  metadataGatewayUrl: string;
};

/**
 * Sends the PFP + Twitter handle to our serverless backend, which pins them
 * to IPFS via Pinata and returns a short `ipfs://<jsonCid>` URI.
 *
 * Returning a short URI (rather than an inlined data: URI) keeps the
 * `mintDunce()` calldata small and avoids the "oversized data" revert on the
 * Ritual RPC.
 */
export async function pinMintMetadata({
  data,
}: {
  data: PinInputData;
}): Promise<PinResult> {
  const parsed = PinInput.parse(data);
  const imageBytes = Math.ceil((parsed.imageBase64.length * 3) / 4);
  if (imageBytes > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 5MB limit.");
  }

  const res = await fetch("/api/pin-metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  });

  if (!res.ok) {
    let msg = `Metadata pinning failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const json = (await res.json()) as PinResult;
  if (!json?.tokenURI?.startsWith("ipfs://")) {
    throw new Error("Backend returned an invalid tokenURI.");
  }
  return json;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Fallback: build a tiny on-chain-safe tokenURI entirely in the browser.    */
/* Used when the /api/pin-metadata endpoint is missing (404), times out,     */
/* or otherwise fails. The result is a `data:application/json;base64,…` URI  */
/* with NO embedded raster image — just an SVG placard referencing the      */
/* handle and dunce number. This keeps calldata well under any RPC limit.   */
/* ────────────────────────────────────────────────────────────────────────── */

function b64encodeUtf8(str: string): string {
  // Safe UTF-8 → base64 (btoa only handles Latin-1).
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function buildFallbackTokenURI({
  handle,
  nextId,
}: {
  handle: string;
  nextId: number;
}): { tokenURI: string; imageDataUri: string } {
  const safeHandle = handle.replace(/[<>&"']/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#1a0b2e"/><stop offset="1" stop-color="#e8b84a"/>` +
    `</linearGradient></defs>` +
    `<rect width="512" height="512" fill="url(#g)"/>` +
    `<text x="50%" y="42%" text-anchor="middle" font-family="monospace" font-size="32" fill="#fff">DUNCE</text>` +
    `<text x="50%" y="55%" text-anchor="middle" font-family="monospace" font-size="72" fill="#fff">#${nextId}</text>` +
    `<text x="50%" y="72%" text-anchor="middle" font-family="monospace" font-size="28" fill="#fff">@${safeHandle}</text>` +
    `</svg>`;
  const imageDataUri = `data:image/svg+xml;base64,${b64encodeUtf8(svg)}`;

  const metadata = {
    name: `Dunce #${nextId}`,
    description: `Great Dunce of Ritual minted by @${safeHandle}.`,
    image: imageDataUri,
    attributes: [
      { trait_type: "Handle", value: safeHandle },
      { trait_type: "Number", value: nextId },
    ],
  };
  const tokenURI = `data:application/json;base64,${b64encodeUtf8(
    JSON.stringify(metadata),
  )}`;
  return { tokenURI, imageDataUri };
}
