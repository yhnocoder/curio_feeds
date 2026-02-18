import { createHash } from "node:crypto";
import { r2 } from "../r2/client.js";
import { logger } from "../utils/logger.js";

const DOWNLOAD_TIMEOUT_MS = 30_000;

function inferExtension(contentType: string | null, url: string): string {
  if (contentType) {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/avif": "avif",
    };
    const ext = map[contentType.split(";")[0].trim().toLowerCase()];
    if (ext) return ext;
  }

  // Fallback: try URL extension
  const match = url.match(/\.(\w{3,4})(?:[?#]|$)/);
  if (match) return match[1].toLowerCase();

  return "bin";
}

export async function downloadAndUpload(
  originalUrl: string,
  feedId: string,
  itemGuid: string,
  imageIndex: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(originalUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} downloading ${originalUrl}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type");
    const ext = inferExtension(contentType, originalUrl);

    const guidHash = createHash("md5").update(itemGuid).digest("hex").slice(0, 8);
    const r2Key = `images/${feedId}/${guidHash}/${imageIndex}.${ext}`;

    await r2.putObject(r2Key, buffer, contentType || undefined);
    logger.debug("Image uploaded to R2", { r2Key, size: buffer.length });

    return r2Key;
  } finally {
    clearTimeout(timeout);
  }
}
