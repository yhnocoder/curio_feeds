import { rpc } from "../db/rpc.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export async function cleanupExpiredItems(): Promise<void> {
  const retentionDays = config.retention.itemDays;
  logger.info("Starting expired items cleanup", { retentionDays });

  const itemIds = await rpc.getExpiredItemIds(retentionDays);

  if (itemIds.length === 0) {
    logger.info("No expired items to clean up");
    return;
  }

  logger.info("Found expired items", { count: itemIds.length });

  const BATCH_SIZE = 100;
  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batch = itemIds.slice(i, i + BATCH_SIZE);
    await rpc.deleteExpiredRecords(batch);
    logger.info("Deleted expired records from DB", { itemCount: batch.length });
  }

  logger.info("Expired items cleanup completed", { total: itemIds.length });
}
