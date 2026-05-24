// Vercel Serverless Function — Node runtime (classic req/res style for max
// compatibility). Receives the user's compressed PFP + Twitter handle, pins
// both the image and a JSON metadata document to IPFS via Pinata, and returns
// a short `ipfs://<jsonCid>` URI plus public gateway URLs.
//
// The smart contract only ever receives that short URI — never raw image data.
//
// Required env (set in Vercel → Project → Settings → Environment Variables):
//   - PINATA_JWT                (server-only, secret)
//   - NEXT_PUBLIC_GATEWAY_URL   (optional, e.g. "gateway.pinata.cloud")

import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  // Allow up to 60s — Pinata uploads of ~400KB images normally finish in
  // a few seconds, but we want plenty of headroom for cold starts.
  maxDuration: 60,
  // Bump body limit above 4.5MB to accommodate base64 overhead on ~3MB images.
  api: { bodyParser: { sizeLimit: "10mb" } },
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PINATA_TIMEOUT_MS = 45_000;
const PINATA_RETRIES = 2; // total attempts = 1 + retries

type PinBody = {
  handle?: string;
  nextId?: number;
  minter?: string;
  imageBase64?: string;
  imageMime?: "image/jpeg" | "image/png";
};

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  attempts: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? PINATA_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      // Retry on 5xx + 429; return otherwise (even 4xx — caller decides).
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`Pinata ${res.status}: ${await res.text()}`);
      } else {
        return res;
      }
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
    }
    // Exponential backoff: 500ms, 1.5s, …
    await new Promise((r) => setTimeout(r, 500 * Math.pow(3, i)));
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Pinata request failed after retries.");
}

async function pinFile(
  buf: Buffer,
  filename: string,
  mime: string,
  jwt: string,
): Promise<string> {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([new Uint8Array(buf)], { type: mime }),
    filename,
  );
  const res = await fetchWithRetry(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: fd,
    },
    PINATA_RETRIES + 1,
  );
  if (!res.ok) {
    throw new Error(`Pinata file pin failed: ${res.status} ${await res.text()}`);
  }
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

async function pinJson(json: unknown, jwt: string): Promise<string> {
  const res = await fetchWithRetry(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pinataContent: json }),
    },
    PINATA_RETRIES + 1,
  );
  if (!res.ok) {
    throw new Error(`Pinata JSON pin failed: ${res.status} ${await res.text()}`);
  }
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Health-check — lets the frontend confirm the route is actually deployed
  // and the env vars are wired up before the user clicks Mint.
  if (req.method === "GET") {
    res.status(200).json({
      ok: true,
      route: "/api/pin-metadata",
      hasPinataJwt: !!process.env.PINATA_JWT,
      gateway: process.env.NEXT_PUBLIC_GATEWAY_URL || "gateway.pinata.cloud",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.error("[pin-metadata] PINATA_JWT is not set in env.");
    res.status(500).json({
      error:
        "Server misconfigured: PINATA_JWT is missing. Set it in Vercel → Project Settings → Environment Variables.",
    });
    return;
  }

  // Vercel auto-parses JSON when Content-Type is application/json. Fall back
  // to manual parsing if it arrives as a string.
  let body: PinBody;
  try {
    body =
      typeof req.body === "string"
        ? (JSON.parse(req.body) as PinBody)
        : ((req.body ?? {}) as PinBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }

  const { handle, nextId, minter, imageBase64, imageMime } = body;

  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    res.status(400).json({ error: "Invalid handle." });
    return;
  }
  if (!nextId || !Number.isInteger(nextId) || nextId < 1 || nextId > 666) {
    res.status(400).json({ error: "Invalid nextId." });
    return;
  }
  if (!minter || !/^0x[a-fA-F0-9]{40}$/.test(minter)) {
    res.status(400).json({ error: "Invalid minter address." });
    return;
  }
  if (!imageBase64 || typeof imageBase64 !== "string") {
    res.status(400).json({ error: "Missing image data." });
    return;
  }
  if (imageMime !== "image/jpeg" && imageMime !== "image/png") {
    res.status(400).json({ error: "Image must be JPEG or PNG." });
    return;
  }

  const cleanBase64 = imageBase64.includes(",")
    ? imageBase64.slice(imageBase64.indexOf(",") + 1)
    : imageBase64;

  const imgBuf = Buffer.from(cleanBase64, "base64");
  if (imgBuf.length === 0 || imgBuf.length > MAX_IMAGE_BYTES) {
    res.status(400).json({ error: "Image exceeds 5MB limit or is empty." });
    return;
  }

  try {
    console.log(
      `[pin-metadata] Upload start handle=@${handle} nextId=${nextId} bytes=${imgBuf.length}`,
    );
    const ext = imageMime === "image/png" ? "png" : "jpg";
    const imageCid = await pinFile(
      imgBuf,
      `dunce-${nextId}.${ext}`,
      imageMime,
      jwt,
    );
    console.log(`[pin-metadata] Image pinned cid=${imageCid}`);

    const metadata = {
      name: `Dunce #${nextId}`,
      description:
        "One of 666 Great Dunce's of Ritual — a free mint to unlock Ritual Mainnet. Designed by crankywakker.",
      image: `ipfs://${imageCid}`,
      external_url: "https://ritualfoundation.org",
      attributes: [
        { trait_type: "Creator", value: "crankywakker" },
        { trait_type: "Edition", value: nextId, max_value: 666 },
        { trait_type: "Twitter Handle", value: handle },
        { trait_type: "Minter", value: minter },
      ],
    };
    console.log(`[pin-metadata] Metadata created for #${nextId}`);

    const jsonCid = await pinJson(metadata, jwt);
    console.log(`[pin-metadata] Metadata pinned cid=${jsonCid}`);

    const tokenURI = `ipfs://${jsonCid}`;
    const gatewayHost =
      (process.env.NEXT_PUBLIC_GATEWAY_URL || "gateway.pinata.cloud").replace(
        /^https?:\/\//,
        "",
      );
    const gateway = `https://${gatewayHost}/ipfs`;

    console.log(`[pin-metadata] Final tokenURI=${tokenURI}`);

    res.status(200).json({
      tokenURI,
      imageGatewayUrl: `${gateway}/${imageCid}`,
      metadataGatewayUrl: `${gateway}/${jsonCid}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[pin-metadata] Pinning failed:", msg);
    res.status(502).json({ error: msg });
  }
}
