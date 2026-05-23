// Vercel serverless function (Node runtime).
// Receives the user's PFP + Twitter handle, pins the image AND a JSON metadata
// document to IPFS via Pinata, and returns a short `ipfs://<jsonCid>` URI.
// The smart contract only ever sees that short URI — never the raw image data.

export const config = {
  runtime: "nodejs",
  // Vercel default body limit is ~4.5MB; allow some headroom for base64 overhead.
  maxDuration: 30,
};

type PinBody = {
  handle?: string;
  nextId?: number;
  minter?: string;
  imageBase64?: string;
  imageMime?: "image/jpeg" | "image/png";
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

async function pinFile(
  buf: Buffer,
  filename: string,
  mime: string,
  jwt: string,
): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: mime }), filename);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`Pinata file pin failed: ${res.status} ${await res.text()}`);
  }
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
    body: JSON.stringify({ pinataContent: json }),
  });
  if (!res.ok) {
    throw new Error(`Pinata JSON pin failed: ${res.status} ${await res.text()}`);
  }
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return new Response(
      JSON.stringify({ error: "PINATA_JWT not configured on server." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: PinBody;
  try {
    body = (await req.json()) as PinBody;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { handle, nextId, minter, imageBase64, imageMime } = body;

  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return badRequest("Invalid handle.");
  }
  if (!nextId || !Number.isInteger(nextId) || nextId < 1 || nextId > 666) {
    return badRequest("Invalid nextId.");
  }
  if (!minter || !/^0x[a-fA-F0-9]{40}$/.test(minter)) {
    return badRequest("Invalid minter address.");
  }
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return badRequest("Missing image data.");
  }
  if (imageMime !== "image/jpeg" && imageMime !== "image/png") {
    return badRequest("Image must be JPEG or PNG.");
  }

  const cleanBase64 = imageBase64.includes(",")
    ? imageBase64.slice(imageBase64.indexOf(",") + 1)
    : imageBase64;

  const imgBuf = Buffer.from(cleanBase64, "base64");
  if (imgBuf.length === 0 || imgBuf.length > MAX_IMAGE_BYTES) {
    return badRequest("Image exceeds 5MB limit or is empty.");
  }

  try {
    const ext = imageMime === "image/png" ? "png" : "jpg";
    const imageCid = await pinFile(
      imgBuf,
      `dunce-${nextId}.${ext}`,
      imageMime,
      jwt,
    );

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

    const jsonCid = await pinJson(metadata, jwt);
    const tokenURI = `ipfs://${jsonCid}`;
    const gateway = "https://gateway.pinata.cloud/ipfs";

    return new Response(
      JSON.stringify({
        tokenURI,
        imageGatewayUrl: `${gateway}/${imageCid}`,
        metadataGatewayUrl: `${gateway}/${jsonCid}`,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
