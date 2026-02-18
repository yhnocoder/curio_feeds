import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createHash, randomUUID } from "node:crypto";
import { rpc } from "../db/rpc.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const app = new Hono();

// Bearer token 认证
app.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${config.proxy.authToken}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// -- Feeds --

app.post("/api/feeds", async (c) => {
  const body = await c.req.json<{ url: string; intervalMinutes?: number }>();
  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }
  const now = new Date().toISOString();
  const feed = await rpc.addFeed(
    createHash("md5").update(body.url).digest("hex").slice(0, 16),
    body.url, body.intervalMinutes ?? null, now, now
  );
  return c.json({ data: feed }, 201);
});

app.delete("/api/feeds/:id", async (c) => {
  const id = c.req.param("id");
  await rpc.softDeleteFeed(id, new Date().toISOString());
  return c.json({ data: { ok: true } });
});

app.get("/api/feeds", async (c) => {
  const feeds = await rpc.listFeeds();
  return c.json({ data: feeds });
});

// -- Groups --

app.post("/api/groups", async (c) => {
  const body = await c.req.json<{ name: string }>();
  if (!body.name) {
    return c.json({ error: "name is required" }, 400);
  }
  const now = new Date().toISOString();
  const group = await rpc.createGroup(randomUUID(), body.name, now);
  return c.json({ data: group }, 201);
});

app.delete("/api/groups/:id", async (c) => {
  await rpc.deleteGroup(c.req.param("id"));
  return c.json({ data: { ok: true } });
});

app.get("/api/groups", async (c) => {
  const groups = await rpc.listGroups();
  return c.json({ data: groups });
});

app.post("/api/groups/:groupId/feeds", async (c) => {
  const groupId = c.req.param("groupId");
  const body = await c.req.json<{ feedId: string }>();
  if (!body.feedId) {
    return c.json({ error: "feedId is required" }, 400);
  }
  await rpc.addFeedToGroup(groupId, body.feedId, new Date().toISOString());
  return c.json({ data: { ok: true } }, 201);
});

app.delete("/api/groups/:groupId/feeds/:feedId", async (c) => {
  await rpc.removeFeedFromGroup(c.req.param("groupId"), c.req.param("feedId"));
  return c.json({ data: { ok: true } });
});

export function startApiServer(): void {
  serve({ fetch: app.fetch, port: config.api.port }, () => {
    logger.info("API server started", { port: config.api.port });
  });
}
