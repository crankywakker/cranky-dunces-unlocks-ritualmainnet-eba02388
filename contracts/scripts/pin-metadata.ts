/**
 * Server-side metadata assembler.
 *
 * Run from your backend (or a Next.js / TanStack server route) at mint-time:
 *   1. Resolve Twitter handle → high-res profile image URL.
 *   2. Pin the image to Pinata → ipfs://imageCid
 *   3. Build the JSON (name "Dunce #N", image, attributes incl. crankywakker).
 *   4. Pin the JSON → ipfs://jsonCid
 *   5. Pass `ipfs://jsonCid` to GreatDuncesOfRitual.mintDunce(uri).
 *
 * Env required:
 *   TWITTER_BEARER_TOKEN  – Twitter API v2 Bearer (paid Basic tier+)
 *   PINATA_JWT            – Pinata JWT (https://app.pinata.cloud/keys)
 */

const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN!;
const PINATA_JWT     = process.env.PINATA_JWT!;

const FALLBACK_IMAGE =
  "https://raw.githubusercontent.com/crankywakker/dunces/main/fallback.png";

interface TwitterUser {
  data?: { id: string; name: string; username: string; profile_image_url?: string };
  errors?: unknown;
}

export async function resolveTwitterPfp(handle: string): Promise<string> {
  const username = handle.replace(/^@+/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return FALLBACK_IMAGE;

  const res = await fetch(
    `https://api.twitter.com/2/users/by/username/${username}?user.fields=profile_image_url`,
    { headers: { Authorization: `Bearer ${TWITTER_BEARER}` } },
  );
  if (!res.ok) return FALLBACK_IMAGE;

  const json = (await res.json()) as TwitterUser;
  const url  = json?.data?.profile_image_url;
  if (!url) return FALLBACK_IMAGE;

  // upgrade _normal.jpg → _400x400.jpg for high-res PFP
  return url.replace(/_normal(\.[a-zA-Z]+)$/, "_400x400$1");
}

async function pinFileToIPFS(buf: ArrayBuffer, filename: string, mime: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: mime }), filename);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`Pinata file pin failed: ${res.status} ${await res.text()}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

async function pinJSONToIPFS(json: unknown): Promise<string> {
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pinataContent: json }),
  });
  if (!res.ok) throw new Error(`Pinata json pin failed: ${res.status} ${await res.text()}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

/** Build & pin metadata. Returns the `ipfs://CID` URI to pass to mintDunce(). */
export async function assembleMetadata(opts: {
  nextTokenId: number;     // current totalSupply + 1
  twitterHandle: string;
  minter: `0x${string}`;
}): Promise<string> {
  const { nextTokenId, twitterHandle, minter } = opts;

  // 1. Twitter PFP
  const pfpUrl = await resolveTwitterPfp(twitterHandle);
  const imgRes = await fetch(pfpUrl);
  if (!imgRes.ok) throw new Error(`PFP fetch failed: ${imgRes.status}`);
  const mime  = imgRes.headers.get("content-type") ?? "image/jpeg";
  const ext   = mime.split("/")[1]?.split(";")[0] ?? "jpg";
  const bytes = await imgRes.arrayBuffer();

  // 2. Pin image
  const imageCid = await pinFileToIPFS(bytes, `dunce-${nextTokenId}.${ext}`, mime);

  // 3. Build JSON
  const metadata = {
    name: `Dunce #${nextTokenId}`,
    description:
      "The Great Dunce's of Ritual — 666 mints to unlock Ritual Mainnet. Protocol designed by crankywakker.",
    image: `ipfs://${imageCid}`,
    external_url: "https://ritualfoundation.org",
    attributes: [
      { trait_type: "Creator",        value: "crankywakker" },
      { trait_type: "Collection",     value: "The Great Dunce's of Ritual" },
      { trait_type: "Edition",        value: nextTokenId, max_value: 666 },
      { trait_type: "Twitter Handle", value: twitterHandle.replace(/^@+/, "") },
      { trait_type: "Minter",         value: minter },
    ],
  };

  // 4. Pin JSON
  const jsonCid = await pinJSONToIPFS(metadata);
  return `ipfs://${jsonCid}`;
}

// ---- CLI usage: `bun run scripts/pin-metadata.ts <handle> <nextId> <minter>` ----
if (import.meta.main) {
  const [handle, nextId, minter] = process.argv.slice(2);
  if (!handle || !nextId || !minter) {
    console.error("Usage: bun run scripts/pin-metadata.ts <handle> <nextTokenId> <minterAddress>");
    process.exit(1);
  }
  assembleMetadata({
    twitterHandle: handle,
    nextTokenId: Number(nextId),
    minter: minter as `0x${string}`,
  })
    .then((uri) => console.log(uri))
    .catch((e) => { console.error(e); process.exit(1); });
}
