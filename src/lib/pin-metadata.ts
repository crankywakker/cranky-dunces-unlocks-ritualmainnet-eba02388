import { z } from "zod";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_PIN_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2; // total attempts = 1 + retries

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

export type PinPhase =
  | "compressing"
  | "uploading"
  | "pinning"
  | "retrying"
  | "done";

export type PinProgress = (phase: PinPhase, detail?: string) => void;

/**
 * Sends the PFP + Twitter handle to our Vercel serverless backend, which
 * pins them to IPFS via Pinata and returns a short `ipfs://<jsonCid>` URI.
 *
 * Implements:
 *  - 60s per-attempt AbortController timeout
 *  - exponential-backoff retry on network failures + 5xx/504 responses
 *  - phased progress callback for UI loading states
 *  - structured console logging
 */
export async function pinMintMetadata({
  data,
  timeoutMs = DEFAULT_PIN_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  onProgress,
}: {
  data: PinInputData;
  timeoutMs?: number;
  retries?: number;
  onProgress?: PinProgress;
}): Promise<PinResult> {
  const parsed = PinInput.parse(data);
  const imageBytes = Math.ceil((parsed.imageBase64.length * 3) / 4);
  if (imageBytes > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 5MB limit.");
  }

  const totalAttempts = retries + 1;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    onProgress?.(
      attempt === 1 ? "uploading" : "retrying",
      attempt === 1
        ? "Uploading image to IPFS…"
        : `Retrying upload (attempt ${attempt}/${totalAttempts})…`,
    );
    console.log(
      `[pin-metadata] Upload start attempt=${attempt}/${totalAttempts} bytes=${imageBytes}`,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch("/api/pin-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // 404 means the route isn't deployed — no point retrying.
      if (res.status === 404) {
        throw new Error(
          "Pinning endpoint not found (404). The /api/pin-metadata route is missing on this deployment.",
        );
      }

      if (!res.ok) {
        let msg = `Metadata pinning failed (${res.status})`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        // Retry on 5xx / 504 / 429.
        if (
          (res.status >= 500 || res.status === 429) &&
          attempt < totalAttempts
        ) {
          lastErr = new Error(msg);
          console.warn(
            `[pin-metadata] ${msg} — retrying in ${backoffMs(attempt)}ms`,
          );
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new Error(msg);
      }

      onProgress?.("pinning", "Pinning metadata to IPFS…");
      const json = (await res.json()) as PinResult;
      if (!json?.tokenURI?.startsWith("ipfs://")) {
        throw new Error("Backend returned an invalid tokenURI.");
      }
      console.log(`[pin-metadata] Success tokenURI=${json.tokenURI}`);
      onProgress?.("done");
      return json;
    } catch (e) {
      clearTimeout(timeoutId);
      const err =
        e instanceof Error && e.name === "AbortError"
          ? new Error("Metadata pinning timed out.")
          : e instanceof Error
            ? e
            : new Error(String(e));

      // Don't retry on 404 / validation / abort-from-non-timeout.
      const retriable =
        attempt < totalAttempts &&
        !/404|Invalid|exceeds|misconfigured|PINATA_JWT/i.test(err.message);

      if (retriable) {
        lastErr = err;
        console.warn(
          `[pin-metadata] ${err.message} — retrying in ${backoffMs(attempt)}ms`,
        );
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Metadata pinning failed.");
}

function backoffMs(attempt: number): number {
  // 1s, 3s, 9s…
  return 1000 * Math.pow(3, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Optional: probe the API route at runtime so we can fail fast with a useful
 * message if /api/pin-metadata isn't deployed or PINATA_JWT isn't set on the
 * hosting environment.
 */
export async function pinHealthcheck(): Promise<{
  ok: boolean;
  hasPinataJwt?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch("/api/pin-metadata", { method: "GET" });
    if (res.status === 404) {
      return { ok: false, error: "Pinning route /api/pin-metadata not found." };
    }
    if (!res.ok) return { ok: false, error: `Healthcheck ${res.status}` };
    const j = (await res.json()) as { ok?: boolean; hasPinataJwt?: boolean };
    return { ok: !!j?.ok, hasPinataJwt: !!j?.hasPinataJwt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Client-side image compression: downscale to ≤400×400, re-encode as JPEG  */
/* at quality 0.7. Keeps API payloads tiny and well under serverless body    */
/* size + timeout limits.                                                    */
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
