import { r2 } from "../r2/client.js";
import { logger } from "../utils/logger.js";

export async function backupXml(
  feedId: string,
  xmlBuffer: Buffer
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `backups/${feedId}/${timestamp}.xml`;

  await r2.putObject(key, xmlBuffer, "application/xml");
  logger.info("XML backup saved", { feedId, key });
}
