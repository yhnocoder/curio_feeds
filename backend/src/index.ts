import { schedule } from "node-cron";
import { config } from "./config.js";
import { syncFeeds } from "./feeds/sync.js";
import { runScheduledFeeds } from "./feeds/scheduler.js";
import { cleanupExpiredItems } from "./cleanup/lifecycle.js";
import { logger } from "./utils/logger.js";

async function feedCycle(): Promise<void> {
  try {
    await syncFeeds();
    await runScheduledFeeds();
  } catch (err) {
    logger.error("Feed cycle failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function cleanupCycle(): Promise<void> {
  try {
    await cleanupExpiredItems();
  } catch (err) {
    logger.error("Cleanup cycle failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main(): Promise<void> {
  logger.info("CurioFeeds RSS Collector starting", {
    fetchInterval: config.schedule.defaultIntervalMinutes,
    maxConcurrent: config.schedule.maxConcurrentFeeds,
    retentionDays: config.retention.itemDays,
  });

  // 立即执行首次 feed cycle
  await feedCycle();

  // 每 60 分钟执行 feed cycle
  schedule("*/60 * * * *", () => {
    feedCycle();
  });

  // 每天 3:00 清理过期数据
  schedule("0 3 * * *", () => {
    cleanupCycle();
  });

  logger.info("Cron jobs scheduled, collector is running");
}

main().catch((err) => {
  logger.error("Fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
