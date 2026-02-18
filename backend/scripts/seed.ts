/**
 * 初始化 DB 种子数据：从 feeds.json 导入 feed 列表
 * 用法: npx tsx scripts/seed.ts
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { rpc } from "../src/db/rpc.js";

interface FeedConfig {
  url: string;
  intervalMinutes?: number;
}

async function seed(): Promise<void> {
  const existing = await rpc.listFeeds();
  if (existing.length > 0) {
    console.log(`DB 已有 ${existing.length} 个 feed，跳过 seed`);
    return;
  }

  const feedsPath = resolve(import.meta.dirname, "../feeds.json");
  const raw = await readFile(feedsPath, "utf-8");
  const configs: FeedConfig[] = JSON.parse(raw);

  const now = new Date().toISOString();
  for (const cfg of configs) {
    const feed = await rpc.addFeed(
      createHash("md5").update(cfg.url).digest("hex").slice(0, 16),
      cfg.url,
      cfg.intervalMinutes ?? null,
      now,
      now,
    );
    console.log(`已添加: ${feed.url} (${feed.id})`);
  }

  console.log(`Seed 完成，共导入 ${configs.length} 个 feed`);
}

seed().catch((err) => {
  console.error("Seed 失败:", err);
  process.exit(1);
});
