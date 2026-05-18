import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Accepts a user-uploaded image (base64) + metadata fields, pins the image to
 * Pinata, then pins the ERC-721 metadata JSON. Returns `ipfs://<jsonCid>` for
 * the client to pass into `mintDunce(uri)`.
 *
 * Server-only secret (read INSIDE the handler):
 *   PINATA_JWT  (Pinata JWT, "pinFileToIPFS" + "pinJSONToIPFS")
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

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

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pinImage(
  bytes: Uint8Array,
  mime: string,
  jwt: string,
): Promise<string> {
  const ext = mime === "image/png" ? "png" : "jpg";
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: mime });
  const form = new FormData();
  form.append("file", blob, `pfp.${ext}`);
  form.append("pinataMetadata", JSON.stringify({ name: "dunce-pfp" }));

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata pinFile failed (${res.status})`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

async function pinJson(json: unknown, jwt: string): Promise<string> {
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: json,
      pinataMetadata: { name: "dunce-metadata" },
    }),
  });
  if (!res.ok) throw new Error(`Pinata pinJSON failed (${res.status})`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

export const pinMintMetadata = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PinInput.parse(input))
  .handler(async ({ data }) => {
    const PINATA_JWT = process.env.PINATA_JWT;
    if (!PINATA_JWT) throw new Error("Server missing PINATA_JWT.");

    const bytes = base64ToBytes(data.imageBase64);
    if (bytes.byteLength === 0) throw new Error("Empty image upload.");
    if (bytes.byteLength > MAX_IMAGE_BYTES)
      throw new Error("Image exceeds 5MB limit.");

    const imageCid = await pinImage(bytes, data.imageMime, PINATA_JWT);

    const metadata = {
      name: `Dunce #${data.nextId}`,
      description:
        "One of 666 Great Dunce's of Ritual — a free mint to unlock Ritual Mainnet. Designed by crankywakker.",
      image: `ipfs://${imageCid}`,
      external_url: "https://ritualfoundation.org",
      attributes: [
        { trait_type: "Creator", value: "crankywakker" },
        { trait_type: "Edition", value: data.nextId, max_value: 666 },
        { trait_type: "Twitter Handle", value: data.handle },
        { trait_type: "Minter", value: data.minter },
      ],
    };

    const jsonCid = await pinJson(metadata, PINATA_JWT);
    return {
      tokenURI: `ipfs://${jsonCid}`,
      imageGatewayUrl: `https://gateway.pinata.cloud/ipfs/${imageCid}`,
      metadataGatewayUrl: `https://gateway.pinata.cloud/ipfs/${jsonCid}`,
    };
  });
