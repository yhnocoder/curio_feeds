# CurioFeeds RSS Collector

RSS 拉取 → 编码转换 → 内容解析 → D1 存储 → 图片归档至 R2 → XML 备份 → 过期数据清理。

系统由两部分组成：运行在自有服务器上的 Node.js 后端（负责所有计算和调度），以及部署在 Cloudflare 上的 RPC Worker（作为 D1 数据库的类型安全访问代理）。

## 代码结构

```
curio_feeds/
├── backend/                  # 自有服务器（Node.js / TypeScript）
│   ├── feeds.json            # Feed 订阅配置（source of truth）
│   ├── .env.example          # 环境变量模板
│   └── src/
│       ├── db/               # RPC client（类型安全，16 个命名方法）
│       ├── r2/               # S3 兼容的 R2 客户端
│       ├── feeds/            # Feed 同步、调度、单 feed 抓取全流程
│       ├── parser/           # 编码检测 + RSS 解析
│       ├── images/           # 图片提取、下载上传、重试管理
│       ├── backup/           # 原始 XML 备份到 R2
│       ├── cleanup/          # 过期数据级联清理
│       └── utils/            # 结构化日志
│
├── worker/                   # Cloudflare RPC Worker（D1 认证代理）
│   └── src/
│       ├── index.ts          # 入口：auth + action dispatch
│       ├── schema.ts         # D1 表结构（首次请求自动 migrate）
│       └── handlers/         # 按领域划分的 RPC handler
│           ├── feeds.ts      # 6 个 feed 操作
│           ├── items.ts      # 3 个 item 操作
│           ├── images.ts     # 5 个 image_task 操作
│           └── cleanup.ts    # 2 个清理操作
│
└── design/                   # 技术设计文档
```

## 模块划分

### RPC Worker (`worker/`)

Cloudflare Worker，作为自有服务器与 D1 之间的类型安全桥梁。暴露单一 POST 端点：

- `POST /rpc` — body 为 `{ action: string, params: object }`，返回 `{ data: T }`

Worker 内部将 action 分发到 16 个命名 handler，不暴露原始 SQL 执行能力。未知 action 返回 400。D1 schema migration 在首次请求时自动执行。

认证方式：`Authorization: Bearer <token>`（AUTH_TOKEN 未设置时跳过认证，方便本地开发）。

### 后端模块

**db** — `rpc.ts` 封装对 RPC Worker 的 HTTP 调用，提供 16 个类型安全的方法（`listFeedUrls`、`getDueFeeds`、`markFeedSuccess` 等），每个方法对应 Worker 的一个 action。

**r2** — 基于 `@aws-sdk/client-s3` 的 R2 客户端。提供 `putObject`（上传）和 `deleteObjects`（批量删除，自动按 1000 分块）。

**feeds** — Feed 调度核心。`sync.ts` 读取 `feeds.json` 与数据库做 diff 同步。`scheduler.ts` 查询所有到期 feed，通过 `p-limit` 控制并发（默认 5）。`fetcher.ts` 是单 feed 处理全流程：HTTP 拉取（带条件请求）→ XML 备份 → 编码转换 → RSS 解析 → batch INSERT → 图片处理。失败时走指数退避（30min → 24h 封顶）。

**parser** — `encoding.ts` 按优先级检测编码：Content-Type header → XML 声明 → jschardet 自动检测，然后用 iconv-lite 转 UTF-8。`rss.ts` 封装 feed-parser，处理 GUID 生成（guid → link → MD5 fallback）、pubDate 标准化、相对 URL 解析。

**images** — 与 item 入库解耦。`extractor.ts` 用 cheerio 提取 `<img src>`。`downloader.ts` 下载图片（30s 超时）并上传 R2，key 格式为 `images/{feed_id}/{guid_hash}/{index}.{ext}`。`processor.ts` 管理 image_tasks 生命周期，最多重试 3 次。

**backup** — 每次拉取到新内容时，将原始 HTTP 响应体原样备份到 R2（`backups/{feed_id}/{timestamp}.xml`）。

**cleanup** — 每日清理过期数据（默认 180 天）。级联流程：先删 R2 图片对象，再 batch 删除 image_tasks + items（保证原子性）。R2 先删、D1 后删——孤儿对象可接受，dangling reference 不可接受。

**utils** — 结构化 JSON 日志（timestamp + level + message + data）。

## 运行指南

### 前置条件

- Node.js >= 18
- Cloudflare 账号（已创建 D1 数据库和 R2 bucket）
- `npx wrangler` 已登录

### 1. 部署 RPC Worker

```bash
cd worker
npm install

# 编辑 wrangler.toml，填入你的 D1 database_id
# 设置 Worker 的 AUTH_TOKEN secret
npx wrangler secret put AUTH_TOKEN

# 本地开发
npx wrangler dev

# 部署
npx wrangler deploy
```

### 2. 配置后端

```bash
cd backend
npm install

# 复制并编辑环境变量
cp .env.example .env
```

`.env` 需要填写：

| 变量 | 说明 |
|------|------|
| `PROXY_WORKER_URL` | 已部署的 Worker URL |
| `PROXY_AUTH_TOKEN` | Worker 的 AUTH_TOKEN |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 API token 的 Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API token 的 Secret Key |
| `R2_BUCKET_NAME` | R2 bucket 名称 |

### 3. 配置订阅源

编辑 `backend/feeds.json`：

```json
[
  {
    "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "intervalMinutes": 30
  },
  {
    "url": "https://hnrss.org/frontpage",
    "intervalMinutes": 15
  }
]
```

### 4. 构建并运行

```bash
cd backend
npm run build
npm start
```

启动后会：
1. 同步 `feeds.json` 到数据库（D1 schema 由 Worker 首次请求时自动创建）
2. 立即执行一次 feed 拉取
3. 启动 cron 调度：
   - 每 60 分钟检查到期 feed
   - 每 120 分钟重试失败的图片下载
   - 每天 03:00 清理过期数据
