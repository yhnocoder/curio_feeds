import { schedule } from "node-cron";
import { config } from "./config.js";
import { runScheduledFeeds } from "./feeds/scheduler.js";
import { cleanupExpiredItems } from "./cleanup/lifecycle.js";
import { startApiServer } from "./api/server.js";
import { rpc } from "./db/rpc.js";
import { logger } from "./utils/logger.js";

async function feedCycle(): Promise<void> {
  try {
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
    const deleted = await rpc.deleteMarkedFeeds();
    if (deleted > 0) {
      logger.info("Cleaned up soft-deleted feeds", { count: deleted });
    }
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
    apiPort: config.api.port,
  });

  // 启动 HTTP API server
  startApiServer();

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
