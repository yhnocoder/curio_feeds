import { rpc, type FeedRow } from "../db/rpc.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { backupXml } from "../backup/xml.js";
import { detectAndConvert } from "../parser/encoding.js";
import { parseRss } from "../parser/rss.js";
import { processImages } from "../images/processor.js";

function computeNextFetchAt(failures: number): string {
  if (failures === 0) {
    const next = new Date(
      Date.now() + config.schedule.defaultIntervalMinutes * 60_000
    );
    return next.toISOString();
  }
  // 指数退避: 30min, 1h, 2h, ... 最长 24h
  const delayMinutes = Math.min(30 * Math.pow(2, failures - 1), 1440);
  const next = new Date(Date.now() + delayMinutes * 60_000);
  return next.toISOString();
}

export async function processFeed(feed: FeedRow): Promise<void> {
  logger.info("Fetching feed", { feedId: feed.id, url: feed.url });

  const headers: Record<string, string> = {};
  if (feed.last_etag) headers["If-None-Match"] = feed.last_etag;
  if (feed.last_modified) headers["If-Modified-Since"] = feed.last_modified;

  let response: Response;
  try {
    response = await fetch(feed.url, { headers });
  } catch (err) {
    await handleFailure(feed, err);
    return;
  }

  // 304 Not Modified
  if (response.status === 304) {
    logger.info("Feed not modified (304)", { feedId: feed.id });
    const now = new Date().toISOString();
    await rpc.markFeedNotModified(feed.id, now, computeNextFetchAt(0));
    return;
  }

  if (!response.ok) {
    await handleFailure(
      feed,
      new Error(`HTTP ${response.status} ${response.statusText}`)
    );
    return;
  }

  const rawBuffer = Buffer.from(await response.arrayBuffer());

  // 备份原始 XML 到 R2
  try {
    await backupXml(feed.id, rawBuffer);
  } catch (err) {
    logger.error("XML backup failed", {
      feedId: feed.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 编码检测和转换
  const contentType = response.headers.get("content-type") || "";
  let xmlString: string;
  try {
    xmlString = detectAndConvert(rawBuffer, contentType);
  } catch (err) {
    await handleFailure(feed, err);
    return;
  }

  // 解析 RSS
  let parsed;
  try {
    parsed = parseRss(xmlString, feed.url);
  } catch (err) {
    await handleFailure(feed, err);
    return;
  }

  const newEtag = response.headers.get("etag");
  const newLastModified = response.headers.get("last-modified");
  const now = new Date().toISOString();

  await rpc.markFeedSuccess(
    feed.id,
    parsed.feedTitle || null,
    newEtag,
    newLastModified,
    now,
    computeNextFetchAt(0)
  );

  // 批量插入条目
  if (parsed.items.length > 0) {
    await rpc.insertItems(
      parsed.items.map((item) => ({
        id: item.id,
        feedId: feed.id,
        guid: item.guid,
        link: item.link,
        title: item.title,
        pubDate: item.pubDate,
        contentHtml: item.contentHtml,
        createdAt: now,
      }))
    );
    logger.info("Items inserted", {
      feedId: feed.id,
      count: parsed.items.length,
    });

    // 处理每个新条目的图片
    for (const item of parsed.items) {
      try {
        await processImages(item.id, item.contentHtml, feed.id, item.guid);
      } catch (err) {
        logger.error("Image processing failed", {
          feedId: feed.id,
          itemId: item.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  logger.info("Feed processed successfully", {
    feedId: feed.id,
    itemCount: parsed.items.length,
  });
}

async function handleFailure(feed: FeedRow, err: unknown): Promise<void> {
  const failures = feed.consecutive_failures + 1;
  const errorMsg = err instanceof Error ? err.message : String(err);

  logger.error("Feed fetch failed", {
    feedId: feed.id,
    url: feed.url,
    failures,
    error: errorMsg,
  });

  if (failures >= 10) {
    logger.warn("Feed has failed 10+ consecutive times — manual check recommended", {
      feedId: feed.id,
      url: feed.url,
      failures,
    });
  }

  await rpc.markFeedFailure(feed.id, failures, computeNextFetchAt(failures));
}
