import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { rpc } from "../db/rpc.js";
import { logger } from "../utils/logger.js";

interface FeedConfig {
  url: string;
  intervalMinutes?: number;
}

export async function syncFeeds(): Promise<void> {
  const feedsPath = resolve(import.meta.dirname, "../../feeds.json");
  const raw = await readFile(feedsPath, "utf-8");
  const feedConfigs: FeedConfig[] = JSON.parse(raw);

  const configUrls = new Set(feedConfigs.map((f) => f.url));

  const existingUrls = new Set(await rpc.listFeedUrls());

  // 新增的 feeds
  const newFeeds = feedConfigs.filter((f) => !existingUrls.has(f.url));

  if (newFeeds.length > 0) {
    const now = new Date().toISOString();
    await rpc.insertFeeds(
      newFeeds.map((f) => ({
        id: randomUUID(),
        url: f.url,
        nextFetchAt: now,
        createdAt: now,
      }))
    );
    logger.info("Synced new feeds", {
      count: newFeeds.length,
      urls: newFeeds.map((f) => f.url),
    });
  }

  // 记录已从配置移除的 feeds（数据保留）
  const removedUrls = [...existingUrls].filter((url) => !configUrls.has(url));
  if (removedUrls.length > 0) {
    logger.info("Feeds removed from config (data retained)", {
      urls: removedUrls,
    });
  }
}
