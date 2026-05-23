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
