import iconv from "iconv-lite";
import jschardet from "jschardet";
import { logger } from "../utils/logger.js";

function extractCharsetFromContentType(contentType: string): string | null {
  const match = contentType.match(/charset=([^\s;]+)/i);
  return match ? match[1].trim() : null;
}

function extractCharsetFromXmlDeclaration(buffer: Buffer): string | null {
  // Read first 200 bytes as ASCII to find XML declaration
  const head = buffer.subarray(0, 200).toString("ascii");
  const match = head.match(/<\?xml[^?]*encoding=["']([^"']+)["']/i);
  return match ? match[1].trim() : null;
}

function detectCharset(buffer: Buffer): string {
  const result = jschardet.detect(buffer);
  if (result && result.confidence > 0.5) {
    logger.debug("Charset auto-detected", {
      encoding: result.encoding,
      confidence: result.confidence,
    });
    return result.encoding;
  }
  return "utf-8";
}

export function detectAndConvert(
  buffer: Buffer,
  contentType: string
): string {
  // Priority: Content-Type header > XML declaration > auto-detection
  const charset =
    extractCharsetFromContentType(contentType) ||
    extractCharsetFromXmlDeclaration(buffer) ||
    detectCharset(buffer);

  const normalized = charset.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (normalized === "utf8") {
    return buffer.toString("utf-8");
  }

  if (!iconv.encodingExists(charset)) {
    logger.warn("Unknown encoding, falling back to utf-8", { charset });
    return buffer.toString("utf-8");
  }

  logger.info("Converting encoding to UTF-8", { from: charset });
  return iconv.decode(buffer, charset);
}
