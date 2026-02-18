import { randomUUID } from "node:crypto";
import { rpc } from "../db/rpc.js";
import { logger } from "../utils/logger.js";
import { extractImageUrls } from "./extractor.js";
import { downloadAndUpload } from "./downloader.js";

const MAX_ATTEMPTS = 3;

export async function processImages(
  itemId: string,
  contentHtml: string | null,
  feedId: string,
  itemGuid: string
): Promise<void> {
  if (!contentHtml) return;

  const images = extractImageUrls(contentHtml);
  if (images.length === 0) return;

  // 创建 pending image_tasks
  const now = new Date().toISOString();
  await rpc.insertImageTasks(
    images.map((img) => ({
      id: randomUUID(),
      itemId,
      originalUrl: img.url,
      createdAt: now,
    }))
  );

  // 下载并上传每张图片
  for (const img of images) {
    await attemptDownload(itemId, img.url, img.index, feedId, itemGuid);
  }
}

async function attemptDownload(
  itemId: string,
  originalUrl: string,
  imageIndex: number,
  feedId: string,
  itemGuid: string
): Promise<void> {
  const now = new Date().toISOString();

  try {
    const r2Key = await downloadAndUpload(originalUrl, feedId, itemGuid, imageIndex);
    await rpc.markImageSuccess(itemId, originalUrl, r2Key, now);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn("Image download failed", {
      itemId,
      originalUrl,
      error: errorMsg,
    });
    await rpc.markImageFailure(itemId, originalUrl, errorMsg, now, MAX_ATTEMPTS);
  }
}

export async function retryPendingImages(): Promise<void> {
  const tasks = await rpc.getPendingImageRetries(MAX_ATTEMPTS);
  if (tasks.length === 0) return;

  logger.info("Retrying pending image tasks", { count: tasks.length });

  for (const task of tasks) {
    const itemInfo = await rpc.getItemFeedInfo(task.item_id);
    if (!itemInfo) continue;

    // 获取图片在该 item 中的索引
    const taskUrls = await rpc.getImageTaskUrls(task.item_id);
    const imageIndex = taskUrls.findIndex(
      (r) => r.original_url === task.original_url
    );

    await attemptDownload(
      task.item_id,
      task.original_url,
      imageIndex >= 0 ? imageIndex : 0,
      itemInfo.feed_id,
      itemInfo.guid
    );
  }
}
