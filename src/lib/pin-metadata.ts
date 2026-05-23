import { z } from "zod";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_PIN_TIMEOUT_MS = 20_000;

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
 * Uses an AbortController so a hanging Vercel function (504) can't lock the
 * mint flow forever — the caller can then fall back to a client-side
 * data: URI.
 */
export async function pinMintMetadata({
  data,
  timeoutMs = DEFAULT_PIN_TIMEOUT_MS,
}: {
  data: PinInputData;
  timeoutMs?: number;
}): Promise<PinResult> {
  const parsed = PinInput.parse(data);
  const imageBytes = Math.ceil((parsed.imageBase64.length * 3) / 4);
  if (imageBytes > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 5MB limit.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch("/api/pin-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Metadata pinning timed out.");
    }
    throw e;
  }
  clearTimeout(timeoutId);

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
/* Client-side image compression: downscale to ≤400×400, re-encode as JPEG  */
/* at quality 0.7. Tiny enough for either the API payload or a fallback     */
/* data: URI embedded in the tokenURI.                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export async function compressImageFile(
  file: File,
  {
    maxWidth = 400,
    maxHeight = 400,
    quality = 0.7,
  }: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<{ dataUrl: string; mime: "image/jpeg"; size: number }> {
  const srcDataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unreadable file"));
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Image decode failed"));
    i.src = srcDataUrl;
  });

  let { width, height } = img;
  if (width > height && width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  } else if (height >= width && height > maxHeight) {
    width = Math.round((width * maxHeight) / height);
    height = maxHeight;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const size = Math.ceil(((dataUrl.split(",")[1] ?? "").length * 3) / 4);
  return { dataUrl, mime: "image/jpeg", size };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Fallback: build a small on-chain-safe tokenURI entirely in the browser.   */
/* Embeds the compressed avatar (JPEG ≤400×400) directly so the NFT still    */
/* shows the user's image even when the pinning service is unavailable.      */
/* ────────────────────────────────────────────────────────────────────────── */

function b64encodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function buildFallbackTokenURI({
  handle,
  nextId,
  avatarDataUri,
}: {
  handle: string;
  nextId: number;
  avatarDataUri?: string | null;
}): { tokenURI: string; imageDataUri: string } {
  const safeHandle = handle.replace(/[<>&"']/g, "");

  let imageDataUri: string;
  if (avatarDataUri && avatarDataUri.startsWith("data:image/")) {
    imageDataUri = avatarDataUri;
  } else {
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
    imageDataUri = `data:image/svg+xml;base64,${b64encodeUtf8(svg)}`;
  }

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
