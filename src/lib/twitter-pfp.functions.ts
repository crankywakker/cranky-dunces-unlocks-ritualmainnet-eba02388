import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const FALLBACK_IMAGE =
  "https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png";

const Input = z.object({
  handle: z
    .string()
    .min(1)
    .max(15)
    .regex(/^[A-Za-z0-9_]+$/, "Invalid handle"),
});

/**
 * Resolves an X (Twitter) handle to a 400x400 profile image URL.
 * Used for live preview in the mint UI before the user confirms.
 * Returns { imageUrl, fallback } — `fallback` is true when the API
 * couldn't resolve the handle (rate limit, not found, etc.).
 */
export const getTwitterPfp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const bearer = process.env.TWITTER_BEARER_TOKEN;
    if (!bearer) {
      return { imageUrl: FALLBACK_IMAGE, fallback: true, error: "missing_token" };
    }
    try {
      const res = await fetch(
        `https://api.twitter.com/2/users/by/username/${encodeURIComponent(
          data.handle,
        )}?user.fields=profile_image_url`,
        { headers: { Authorization: `Bearer ${bearer}` } },
      );
      if (!res.ok) {
        return { imageUrl: FALLBACK_IMAGE, fallback: true, error: `http_${res.status}` };
      }
      const json = (await res.json()) as {
        data?: { profile_image_url?: string };
      };
      const url = json.data?.profile_image_url;
      if (!url) return { imageUrl: FALLBACK_IMAGE, fallback: true, error: "not_found" };
      return {
        imageUrl: url.replace("_normal.", "_400x400."),
        fallback: false,
        error: null as string | null,
      };
    } catch (e) {
      return {
        imageUrl: FALLBACK_IMAGE,
        fallback: true,
        error: e instanceof Error ? e.message : "unknown",
      };
    }
  });
