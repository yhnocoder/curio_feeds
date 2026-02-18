import { config } from "../config.js";

// -- 类型定义 --

export interface FeedRow {
  id: string;
  url: string;
  title: string | null;
  interval_minutes: number | null;
  last_etag: string | null;
  last_modified: string | null;
  last_fetched_at: string | null;
  consecutive_failures: number;
  next_fetch_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface GroupRow {
  id: string;
  name: string;
  created_at: string;
  feed_ids: string[];
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

async function addFeed(
  id: string, url: string, intervalMinutes: number | null, nextFetchAt: string, createdAt: string
): Promise<FeedRow> {
  return request<FeedRow>("addFeed", { id, url, intervalMinutes, nextFetchAt, createdAt });
}

async function softDeleteFeed(id: string, now: string): Promise<void> {
  await request<void>("softDeleteFeed", { id, now });
}

async function listFeeds(): Promise<FeedRow[]> {
  return request<FeedRow[]>("listFeeds");
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

async function getExpiredItemIds(retentionDays: number): Promise<string[]> {
  return request<string[]>("getExpiredItemIds", { retentionDays });
}

// -- Cleanup --

async function deleteExpiredRecords(itemIds: string[]): Promise<void> {
  await request<void>("deleteExpiredRecords", { itemIds });
}

async function deleteMarkedFeeds(): Promise<number> {
  return request<number>("deleteMarkedFeeds");
}

// -- Groups --

async function createGroup(id: string, name: string, createdAt: string): Promise<GroupRow> {
  return request<GroupRow>("createGroup", { id, name, createdAt });
}

async function deleteGroup(id: string): Promise<void> {
  await request<void>("deleteGroup", { id });
}

async function listGroups(): Promise<GroupRow[]> {
  return request<GroupRow[]>("listGroups");
}

async function addFeedToGroup(groupId: string, feedId: string, createdAt: string): Promise<void> {
  await request<void>("addFeedToGroup", { groupId, feedId, createdAt });
}

async function removeFeedFromGroup(groupId: string, feedId: string): Promise<void> {
  await request<void>("removeFeedFromGroup", { groupId, feedId });
}

export const rpc = {
  addFeed,
  softDeleteFeed,
  listFeeds,
  getDueFeeds,
  markFeedNotModified,
  markFeedSuccess,
  markFeedFailure,
  insertItems,
  getExpiredItemIds,
  deleteExpiredRecords,
  deleteMarkedFeeds,
  createGroup,
  deleteGroup,
  listGroups,
  addFeedToGroup,
  removeFeedFromGroup,
};
