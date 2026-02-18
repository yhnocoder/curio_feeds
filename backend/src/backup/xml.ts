import { r2 } from "../r2/client.js";
import { logger } from "../utils/logger.js";

export async function backupXml(
  feedId: string,
  xmlBuffer: Buffer
): Promise<void> {
  // UTC+8 日期作为备份文件名
  const utc8 = new Date(Date.now() + 8 * 3600_000);
  const date = utc8.toISOString().slice(0, 10);
  const key = `backups/${feedId}/${date}.xml`;

  await r2.putObject(key, xmlBuffer, "application/xml");
  logger.info("XML backup saved", { feedId, key });
}
