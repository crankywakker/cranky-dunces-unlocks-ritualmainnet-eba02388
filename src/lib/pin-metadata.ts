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

function dataUri(mime: string, base64: string) {
  return base64.startsWith("data:") ? base64 : `data:${mime};base64,${base64}`;
}

export async function pinMintMetadata({ data }: { data: PinInputData }) {
  const parsed = PinInput.parse(data);
  const imageBytes = Math.ceil((parsed.imageBase64.length * 3) / 4);

  if (imageBytes > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 5MB limit.");
  }

  const imageGatewayUrl = dataUri(parsed.imageMime, parsed.imageBase64);
  const metadata = {
    name: `Dunce #${parsed.nextId}`,
    description:
      "One of 666 Great Dunce's of Ritual — a free mint to unlock Ritual Mainnet. Designed by crankywakker.",
    image: imageGatewayUrl,
    external_url: "https://ritualfoundation.org",
    attributes: [
      { trait_type: "Creator", value: "crankywakker" },
      { trait_type: "Edition", value: parsed.nextId, max_value: 666 },
      { trait_type: "Twitter Handle", value: parsed.handle },
      { trait_type: "Minter", value: parsed.minter },
    ],
  };

  const tokenURI = dataUri(
    "application/json",
    btoa(unescape(encodeURIComponent(JSON.stringify(metadata)))),
  );

  return {
    tokenURI,
    imageGatewayUrl,
    metadataGatewayUrl: tokenURI,
  };
}