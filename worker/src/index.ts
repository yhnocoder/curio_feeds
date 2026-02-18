import { SCHEMA_SQL } from "./schema.js";
import * as feeds from "./handlers/feeds.js";
import * as items from "./handlers/items.js";
import * as images from "./handlers/images.js";
import * as cleanup from "./handlers/cleanup.js";

export interface Env {
  DB: D1Database;
  AUTH_TOKEN: string;
}

// action 名 → handler 映射
// 每个 handler 签名: (db, params) => Promise<unknown>
const handlers: Record<string, (db: D1Database, params: any) => Promise<unknown>> = {
  // feeds
  listFeedUrls: (db) => feeds.listFeedUrls(db),
  insertFeeds: (db, p) => feeds.insertFeeds(db, p),
  getDueFeeds: (db, p) => feeds.getDueFeeds(db, p),
  markFeedNotModified: (db, p) => feeds.markFeedNotModified(db, p),
  markFeedSuccess: (db, p) => feeds.markFeedSuccess(db, p),
  markFeedFailure: (db, p) => feeds.markFeedFailure(db, p),
  // items
  insertItems: (db, p) => items.insertItems(db, p),
  getItemFeedInfo: (db, p) => items.getItemFeedInfo(db, p),
  getExpiredItemIds: (db, p) => items.getExpiredItemIds(db, p),
  // images
  insertImageTasks: (db, p) => images.insertImageTasks(db, p),
  markImageSuccess: (db, p) => images.markImageSuccess(db, p),
  markImageFailure: (db, p) => images.markImageFailure(db, p),
  getPendingImageRetries: (db, p) => images.getPendingImageRetries(db, p),
  getImageTaskUrls: (db, p) => images.getImageTaskUrls(db, p),
  // cleanup
  getImageR2Keys: (db, p) => cleanup.getImageR2Keys(db, p),
  deleteExpiredRecords: (db, p) => cleanup.deleteExpiredRecords(db, p),
};

let migrated = false;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const authHeader = request.headers.get("Authorization");
    if (env.AUTH_TOKEN && (!authHeader || authHeader !== `Bearer ${env.AUTH_TOKEN}`)) {
      return errorResponse("Unauthorized", 401);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/rpc") {
      return errorResponse("Not found", 404);
    }

    // 首次请求执行 migration
    if (!migrated) {
      const statements = SCHEMA_SQL.split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => env.DB.prepare(s));
      await env.DB.batch(statements);
      migrated = true;
    }

    try {
      const body = await request.json<{ action: string; params?: Record<string, unknown> }>();
      const handler = handlers[body.action];
      if (!handler) {
        return errorResponse(`Unknown action: ${body.action}`, 400);
      }
      const result = await handler(env.DB, body.params ?? {});
      return jsonResponse(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return errorResponse(message, 500);
    }
  },
};
