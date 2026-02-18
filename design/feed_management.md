# Feed 管理 — 运行时 CRUD 与 FeedGroup

> **版本**: v0.1
> **日期**: 2026-02-19

---

## 1. 背景与动机

在 Collector 阶段，feed 列表由 `feeds.json` 配置文件管理，启动时与 DB 做 diff 同步。这个方案在早期足够简单，但随着系统演进暴露出两个问题。

第一，缺乏运行时管理能力。每次增删 feed 都需要修改文件并重启服务，无法做到动态调整。第二，没有 feed 分组的概念。后续的 AI 去重和聚合需要知道哪些 feed 属于同一个主题（比如多个科技新闻源），以便在组内做跨源去重。

本文档定义 feed 的运行时 CRUD 能力和 FeedGroup 数据模型，使 DB 成为 feed 配置的唯一来源（source of truth），同时为下游 AI pipeline 提供分组信息。

### 与 feeds.json 的关系

`feeds.json` 不再参与运行时逻辑，但作为 DB 初始化的种子数据保留。频繁 drop 重建 D1 时（开发阶段常见），通过 `npm run seed` 从 feeds.json 快速恢复初始 feed 列表。seed 脚本的逻辑很简单：DB 为空时导入，非空时跳过。

---

## 2. 数据模型变更

### feeds 表扩展

在原有 feeds 表基础上新增两个字段：

`interval_minutes`（INTEGER，可为 NULL）记录该 feed 的自定义拉取间隔。当前阶段所有 feed 共享全局默认间隔，此字段为后续按 feed 粒度调度预留，暂不在调度逻辑中使用。

`deleted_at`（TEXT，ISO 8601）是软删除标记。API 执行删除操作时不会物理删除 feed 记录，而是设置此字段为当前时间。已标记删除的 feed 不再参与调度（`getDueFeeds` 的 WHERE 条件排除 `deleted_at IS NOT NULL` 的记录），也不会出现在 `listFeeds` 的结果中。物理删除在每天的定时 cleanup 中批量执行。

### 新增 feed_groups 表

```sql
CREATE TABLE IF NOT EXISTS feed_groups (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);
```

每个 group 代表一个主题分组，name 唯一。group 本身是轻量的元数据容器，不包含任何业务逻辑。

### 新增 feed_group_members 表

```sql
CREATE TABLE IF NOT EXISTS feed_group_members (
  group_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, feed_id),
  FOREIGN KEY (group_id) REFERENCES feed_groups(id),
  FOREIGN KEY (feed_id) REFERENCES feeds(id)
);
```

这是一张标准的多对多关联表。一个 feed 可以属于多个 group，一个 group 可以包含多个 feed。`feed_id` 上建了索引以加速"查询某个 feed 属于哪些 group"的反向查询。

---

## 3. 软删除与生命周期

### 为什么用软删除

直接物理删除 feed 会导致级联问题：该 feed 下的所有 items 和 group 关联都需要同步清理，这在 API 请求中执行开销不小，且一旦误删无法恢复。软删除将"标记"和"清理"解耦——API 层只负责打标记（毫秒级），实际清理交给 cleanup 定时任务在低峰时段批量执行。

### 清理流程

每天 3:00 的 cleanup cycle 在原有的过期 items 清理之后，增加一步 `deleteMarkedFeeds`。该操作查找所有 `deleted_at IS NOT NULL` 的 feed，然后依次删除其 group 关联、items 记录和 feed 自身。这些删除操作通过 D1 batch 在一次事务中完成。

---

## 4. HTTP API

Backend 新增一个 Hono HTTP server，与 Cron 调度在同一进程中运行，共享 RPC client。

### 认证

所有 API 端点使用 Bearer token 认证，复用 `PROXY_AUTH_TOKEN`。这是一个内部管理接口，当前阶段单用户使用，不需要更复杂的认证机制。

### Feed 端点

```
POST   /api/feeds          添加 feed
DELETE /api/feeds/:id       软删除 feed
GET    /api/feeds           列出所有活跃 feed
```

添加 feed 时，请求体为 `{ url: string, intervalMinutes?: number }`。服务端生成 UUID 作为 id，`next_fetch_at` 设为当前时间（立即参与下一轮调度），返回完整的 feed 记录。url 的唯一约束由 D1 保证，重复添加会返回错误。

软删除设置 `deleted_at` 为当前时间。该 feed 立即从 `listFeeds` 和 `getDueFeeds` 结果中消失，但数据仍在 DB 中，直到 cleanup 任务物理删除。

### Group 端点

```
POST   /api/groups                      创建 group
DELETE /api/groups/:id                  删除 group
GET    /api/groups                      列出所有 group（含关联 feed id 列表）
POST   /api/groups/:groupId/feeds       添加 feed 到 group
DELETE /api/groups/:groupId/feeds/:feedId  从 group 移除 feed
```

删除 group 时级联删除 `feed_group_members` 中的关联记录，但不影响 feed 本身。`listGroups` 返回每个 group 及其关联的 feed id 数组，方便上层一次获取完整的分组拓扑。

添加 feed 到 group 使用 `INSERT OR IGNORE`，重复关联是幂等操作，不会报错。

---

## 5. Worker RPC 扩展

在原有 10 个 RPC action 基础上新增 7 个，总计 17 个：

| Action | 所属 Handler | 说明 |
|--------|-------------|------|
| `addFeed` | feeds | 插入单个 feed，返回完整 row |
| `softDeleteFeed` | feeds | 设置 deleted_at |
| `listFeeds` | feeds | 返回所有未删除 feed（替代原 listFeedUrls） |
| `deleteMarkedFeeds` | cleanup | 物理删除已标记 feed + items + group 关联 |
| `createGroup` | groups | 创建 group |
| `deleteGroup` | groups | 删除 group + 级联清理关联 |
| `listGroups` | groups | 返回所有 group 及其 feed id 列表 |
| `addFeedToGroup` | groups | 建立 feed-group 关联 |
| `removeFeedFromGroup` | groups | 解除 feed-group 关联 |

同时移除了两个不再需要的 action：`listFeedUrls`（被 `listFeeds` 替代，返回完整 feed 信息而非仅 url）和 `insertFeeds`（批量插入，被单条 `addFeed` 替代）。

原有的 `getDueFeeds` 查询条件新增 `AND deleted_at IS NULL`，确保已标记删除的 feed 不参与调度。

---

## 6. 已移除的组件

`backend/src/feeds/sync.ts` 整个文件删除。原先每次 feed cycle 都要执行的 feeds.json diff 同步逻辑不再需要——feed 管理已完全迁移到 HTTP API，`index.ts` 中的 `feedCycle()` 直接调用 `runScheduledFeeds()`。

---

## 7. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `worker/src/schema.ts` | 修改 | feeds 表加 interval_minutes、deleted_at；新增两张表 |
| `worker/src/index.ts` | 修改 | 注册新 handler |
| `worker/src/handlers/feeds.ts` | 修改 | 新增 addFeed/softDeleteFeed/listFeeds；getDueFeeds 排除已删除 |
| `worker/src/handlers/groups.ts` | 新建 | group CRUD |
| `worker/src/handlers/cleanup.ts` | 修改 | 新增 deleteMarkedFeeds |
| `backend/src/db/rpc.ts` | 修改 | 对齐新 action，扩展 FeedRow 类型，新增 GroupRow |
| `backend/src/api/server.ts` | 新建 | Hono HTTP server + 路由 |
| `backend/src/config.ts` | 修改 | 新增 api.port |
| `backend/src/index.ts` | 修改 | 启动 HTTP server，移除 syncFeeds，cleanup 加 deleteMarkedFeeds |
| `backend/src/feeds/sync.ts` | 删除 | 不再需要 |
| `backend/scripts/seed.ts` | 新建 | DB 初始化种子脚本 |
| `backend/package.json` | 修改 | 添加 hono、@hono/node-server、tsx |
