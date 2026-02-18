import { config } from "../config.js";

// -- 类型定义 --

export interface FeedRow {
  id: string;
  url: string;
  last_etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
}

export interface ItemFeedInfo {
  feed_id: string;
  guid: string;
}

export interface PendingImageRetry {
  id: string;
  item_id: string;
  original_url: string;
}

// -- RPC 请求 --

async function request<T>(action: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.proxy.url}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.proxy.authToken}`,
    },
    body: JSON.stringify({ action, params }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC ${action} failed (${res.status}): ${text}`);
  }

  const json = await res.json() as { data: T };
  return json.data;
}

// -- Feeds --

async function listFeedUrls(): Promise<string[]> {
  return request<string[]>("listFeedUrls");
}

async function insertFeeds(
  feeds: { id: string; url: string; nextFetchAt: string; createdAt: string }[]
): Promise<void> {
  await request<void>("insertFeeds", { feeds });
}

async function getDueFeeds(now: string): Promise<FeedRow[]> {
  return request<FeedRow[]>("getDueFeeds", { now });
}

async function markFeedNotModified(id: string, now: string, nextFetchAt: string): Promise<void> {
  await request<void>("markFeedNotModified", { id, now, nextFetchAt });
}

async function markFeedSuccess(
  id: string, title: string | null, etag: string | null,
  lastModified: string | null, now: string, nextFetchAt: string
): Promise<void> {
  await request<void>("markFeedSuccess", { id, title, etag, lastModified, now, nextFetchAt });
}

async function markFeedFailure(id: string, failures: number, nextFetchAt: string): Promise<void> {
  await request<void>("markFeedFailure", { id, failures, nextFetchAt });
}

// -- Items --

async function insertItems(
  items: {
    id: string; feedId: string; guid: string; link: string | null;
    title: string | null; pubDate: string | null; contentHtml: string | null; createdAt: string;
  }[]
): Promise<void> {
  await request<void>("insertItems", { items });
}

async function getItemFeedInfo(itemId: string): Promise<ItemFeedInfo | null> {
  return request<ItemFeedInfo | null>("getItemFeedInfo", { itemId });
}

async function getExpiredItemIds(retentionDays: number): Promise<string[]> {
  return request<string[]>("getExpiredItemIds", { retentionDays });
}

// -- Images --

async function insertImageTasks(
  tasks: { id: string; itemId: string; originalUrl: string; createdAt: string }[]
): Promise<void> {
  await request<void>("insertImageTasks", { tasks });
}

async function markImageSuccess(
  itemId: string, originalUrl: string, r2Key: string, now: string
): Promise<void> {
  await request<void>("markImageSuccess", { itemId, originalUrl, r2Key, now });
}

async function markImageFailure(
  itemId: string, originalUrl: string, error: string, now: string, maxAttempts: number
): Promise<void> {
  await request<void>("markImageFailure", { itemId, originalUrl, error, now, maxAttempts });
}

async function getPendingImageRetries(maxAttempts: number): Promise<PendingImageRetry[]> {
  return request<PendingImageRetry[]>("getPendingImageRetries", { maxAttempts });
}

async function getImageTaskUrls(itemId: string): Promise<{ original_url: string }[]> {
  return request<{ original_url: string }[]>("getImageTaskUrls", { itemId });
}

// -- Cleanup --

async function getImageR2Keys(itemIds: string[]): Promise<string[]> {
  return request<string[]>("getImageR2Keys", { itemIds });
}

async function deleteExpiredRecords(itemIds: string[]): Promise<void> {
  await request<void>("deleteExpiredRecords", { itemIds });
}

export const rpc = {
  listFeedUrls,
  insertFeeds,
  getDueFeeds,
  markFeedNotModified,
  markFeedSuccess,
  markFeedFailure,
  insertItems,
  getItemFeedInfo,
  getExpiredItemIds,
  insertImageTasks,
  markImageSuccess,
  markImageFailure,
  getPendingImageRetries,
  getImageTaskUrls,
  getImageR2Keys,
  deleteExpiredRecords,
};
