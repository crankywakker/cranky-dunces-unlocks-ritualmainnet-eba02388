import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Resolves a Twitter handle → 400x400 PFP, pins it to Pinata, then pins the
 * ERC-721 metadata JSON. Returns `ipfs://<jsonCid>` for the client to pass
 * into `mintDunce(uri)`.
 *
 * Server-only secrets, read INSIDE the handler (not at module scope, per the
 * TanStack Start execution model — Cloudflare Workers inject env at request
 * time):
 *   TWITTER_BEARER_TOKEN  (Twitter API v2, paid Basic plan)
 *   PINATA_JWT            (Pinata JWT, "pinFileToIPFS" + "pinJSONToIPFS")
 */

const FALLBACK_IMAGE =
  "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png";

const PinInput = z.object({
  handle: z
    .string()
    .min(1)
    .max(15)
    .regex(/^[A-Za-z0-9_]+$/, "Twitter handle must be alphanumeric/underscore."),
  nextId: z.number().int().min(1).max(666),
  minter: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address."),
});

async function resolveTwitterPfp(handle: string, bearer: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=profile_image_url`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (!res.ok) return FALLBACK_IMAGE;
    const { data } = (await res.json()) as {
      data?: { profile_image_url?: string };
    };
    const url = data?.profile_image_url;
    if (!url) return FALLBACK_IMAGE;
    // Twitter returns _normal (48x48); upgrade to _400x400.
    return url.replace("_normal.", "_400x400.");
  } catch {
    return FALLBACK_IMAGE;
  }
}

async function pinImage(imageUrl: string, jwt: string): Promise<string> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch PFP (${imgRes.status})`);
  const blob = await imgRes.blob();
  const form = new FormData();
  form.append("file", blob, "pfp.jpg");
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
    const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
    const PINATA_JWT = process.env.PINATA_JWT;

    if (!TWITTER_BEARER_TOKEN) throw new Error("Server missing TWITTER_BEARER_TOKEN.");
    if (!PINATA_JWT) throw new Error("Server missing PINATA_JWT.");

    const pfpUrl = await resolveTwitterPfp(data.handle, TWITTER_BEARER_TOKEN);
    const imageCid = await pinImage(pfpUrl, PINATA_JWT);

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
