import { rpc } from "../db/rpc.js";
import { r2 } from "../r2/client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export async function cleanupExpiredItems(): Promise<void> {
  const retentionDays = config.retention.itemDays;
  logger.info("Starting expired items cleanup", { retentionDays });

  // 1. 查找过期条目
  const itemIds = await rpc.getExpiredItemIds(retentionDays);

  if (itemIds.length === 0) {
    logger.info("No expired items to clean up");
    return;
  }

  logger.info("Found expired items", { count: itemIds.length });

  // 分批处理，避免超出 D1 限制
  const BATCH_SIZE = 100;
  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batch = itemIds.slice(i, i + BATCH_SIZE);
    await cleanupBatch(batch);
  }

  logger.info("Expired items cleanup completed", { total: itemIds.length });
}

async function cleanupBatch(itemIds: string[]): Promise<void> {
  // 2. 收集成功的 image_tasks 的 R2 key
  const r2Keys = await rpc.getImageR2Keys(itemIds);

  // 3. 先删 R2 对象（允许孤儿对象，不允许悬挂引用）
  if (r2Keys.length > 0) {
    try {
      await r2.deleteObjects(r2Keys);
      logger.info("Deleted R2 objects", { count: r2Keys.length });
    } catch (err) {
      logger.error("Failed to delete R2 objects", {
        error: err instanceof Error ? err.message : String(err),
        count: r2Keys.length,
      });
    }
  }

  // 4 & 5. 原子删除 image_tasks 和 items
  await rpc.deleteExpiredRecords(itemIds);
  logger.info("Deleted expired records from DB", { itemCount: itemIds.length });
}
