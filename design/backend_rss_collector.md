# RSS 抓取、解析与存储 — Collector 需求文档

> **版本**: v0.3  
> **日期**: 2026-02-18  
> **作者**: Future Gadget Silicon · 系统软件团队

---

## 1. 项目背景与目标

我们正在构建一个个人 RSS 阅读工具。它的核心价值在于：将多个 RSS 源按主题聚合，利用 AI 自动合并重复内容，最终呈现去重后的信息摘要。但这一切的前提是——先把 RSS 内容可靠地抓下来、解析好、存起来。

本文档定义的就是这个基础 pipeline：RSS 拉取 → 内容解析 → 结构化存储 → 图片归档 → 原始数据备份。

本层的定位是**本地信息源**：只负责可靠地获取和存储原始数据，为下游的 AI 去重、聚合等后处理模块提供稳定的数据基础。后处理逻辑作为独立系统/模块实现，与本层解耦。这样做的好处是后续可以灵活地尝试不同的后处理方案，而不需要每次都重新从远程 RSS 源拉取数据。

### 当前阶段的边界

当前是单用户使用，因此在性能和并发方面不做过度设计。以下内容**不在**本文档范围内：客户端 API 设计、AI 去重与聚合逻辑、Feed 管理界面、多用户支持。

---

## 2. 系统架构概述

系统由三个部分协作完成：

**自有服务器**承担所有计算密集型工作——定时调度、HTTP 请求、RSS 解析、图片下载。这些操作涉及大量网络 I/O 和 HTML 处理，放在我们自己的机器上没有资源限制的顾虑。自有服务器作为**无状态计算节点**，不承担任何持久化职责——服务器本身稳定性有限，可能出现意外重启或数据丢失，因此所有持久化数据都存放在 Cloudflare 侧。

**Cloudflare Proxy Worker** 是自有服务器与 D1 之间的桥梁。D1 的全局 REST API 有 rate limit 限制且不支持参数化 batch 查询，因此我们部署一个轻量的 Worker 作为数据库代理，暴露 `query`、`batch`、`exec` 三个 endpoint。Worker 内部通过 Worker Binding API 调用 D1，支持 prepared statements 参数绑定和事务性 batch 操作。自有服务器的所有 D1 读写操作均通过此 Proxy Worker 完成。

**Cloudflare 存储层** 负责数据持久化。结构化数据（feeds、items、任务记录）存入 D1（SQLite），二进制文件（图片、XML 备份）存入 R2（对象存储）。R2 通过 S3 兼容 API 直接访问，无需经过 Proxy Worker。

### 为什么选择 D1 而非本地 SQLite

自有服务器稳定性有限，不适合承担数据持久化职责。D1 将数据托管在 Cloudflare 基础设施上，消除了因服务器故障导致数据丢失的风险。此外，后续阶段会实现客户端 API（以 Cloudflare Worker 形式部署），届时 Worker 可通过 Binding API 直接访问 D1，无需额外的数据迁移。当前的 Proxy Worker 架构也为这一演进留好了路径。

```
┌──────────────────────┐         ┌──────────────────────────────┐
│     自有服务器        │         │         Cloudflare            │
│  （无状态计算节点）    │         │                              │
│                      │         │  Proxy Worker                │
│  Cron 调度           │         │    query / batch / exec      │
│  RSS 拉取 & 解析     │──HTTP──▶│         │                    │
│  图片下载            │         │         ▼ (Worker Binding)   │
│  XML 备份上传        │         │  D1 (SQLite)                 │
│         │            │         │    feeds / items /           │
│         │            │         │    image_tasks               │
│         └────────────│──S3───▶│  R2 (对象存储)                │
│                      │         │    图片 / XML 备份            │
└──────────────────────┘         └──────────────────────────────┘
```

### Proxy Worker 设计要点

- **认证**：使用 Bearer Token 认证，token 通过环境变量配置。
- **Endpoint**：
  - `POST /query` — 单条 SQL，支持参数绑定，对应 `db.prepare(sql).bind(...params).all()`
  - `POST /batch` — 多条 SQL 的事务性批量执行，对应 `db.batch([...])`
  - `POST /exec` — 无参数绑定的原始 SQL 执行，仅用于 migration 等管理操作
- **Batch 语义**：D1 的 batch 按顺序执行，某条失败会回滚整个 batch。自有服务器应将同一个 feed 的所有 items 打包成一个 batch insert，减少网络往返。

---

## 3. 数据模型

所有结构化数据存储在 Cloudflare D1 中，共三张表。

### feeds 表

记录每个 RSS 订阅源的元信息和抓取状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT (PK) | 自生成唯一 ID |
| `url` | TEXT (UNIQUE) | RSS 源地址 |
| `title` | TEXT | Feed 标题，从 RSS channel 中解析 |
| `last_etag` | TEXT | 上次响应的 ETag 值，用于条件请求 |
| `last_modified` | TEXT | 上次响应的 Last-Modified 值 |
| `last_fetched_at` | TEXT (ISO 8601) | 上次成功拉取的时间 |
| `consecutive_failures` | INTEGER (default 0) | 连续失败次数，用于退避调度 |
| `next_fetch_at` | TEXT (ISO 8601) | 下次应拉取的时间 |
| `created_at` | TEXT (ISO 8601) | 创建时间 |

### items 表

每条 RSS item 对应一行。`(feed_id, guid)` 组合具有唯一约束，用于防止重复插入。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT (PK) | 自生成唯一 ID |
| `feed_id` | TEXT (FK → feeds.id) | 所属 Feed |
| `guid` | TEXT | 见下方 GUID 生成规则 |
| `link` | TEXT | 原文链接 |
| `title` | TEXT | 标题 |
| `pub_date` | TEXT (ISO 8601) | 发布时间，解析后统一格式 |
| `content_html` | TEXT | 原始 HTML 内容（来自 `content:encoded` 或 `description`），**immutable** |
| `created_at` | TEXT (ISO 8601) | 入库时间 |

**content_html 不可变原则**：入库后 content_html 不再修改。图片 URL 的替换在读取时根据 `image_tasks` 表动态完成（见第 6 节）。这样做的好处是：保留了干净的原始数据作为 source of truth，避免了多次 mutation 带来的中间状态问题，也方便后续重新提取图片或重新解析。

**已入库 item 内容变更的处理**：如果 RSS 源修改了某条已发布 item 的内容但 guid 不变，`INSERT OR IGNORE` 会跳过该 item，系统中保留的是首次入库时的版本。这是 by design 的行为——与 content_html immutable 原则一致，保证 source of truth 的稳定性。如果后续确实需要跟踪内容变更，应作为独立功能设计（例如引入版本化机制），不在当前范围内。

**GUID 生成规则**按以下优先级取值，取到即停：首先检查 RSS item 中是否存在 `<guid>` 标签，若有则直接使用其值；若没有，则使用 `<link>` 标签的值；极端情况下两者都不存在时，对 `title + pubDate` 拼接后取 MD5 hash 作为兜底。实际场景中，绝大多数 RSS 源至少会提供 link，第三层 fallback 几乎不会触发。

唯一约束为 `UNIQUE(feed_id, guid)`，插入时使用 `INSERT OR IGNORE`，命中约束则跳过，无需额外查询。

### image_tasks 表

管理图片下载任务的生命周期。每张从 content_html 中提取出的图片对应一条记录。一个 item 关联多条 image_tasks（一对多关系）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT (PK) | 自生成唯一 ID |
| `item_id` | TEXT (FK → items.id) | 所属 Item |
| `original_url` | TEXT | 图片在原始 HTML 中的 URL |
| `r2_key` | TEXT (nullable) | 上传成功后的 R2 对象 key |
| `status` | TEXT | `pending` / `success` / `failed` |
| `attempts` | INTEGER (default 0) | 已尝试下载次数 |
| `last_error` | TEXT (nullable) | 最近一次失败的错误信息 |
| `created_at` | TEXT (ISO 8601) | 创建时间 |
| `updated_at` | TEXT (ISO 8601) | 最近一次状态更新时间 |

**不做图片级去重**：即使不同 item 引用了相同的图片 URL，也各自保存独立的 image_task 记录和 R2 对象。单用户场景下 RSS 跨源图片 URL 重复率很低，去重带来的存储节省不值得引入引用计数的复杂度。

状态流转为 `pending → success`（下载并上传 R2 成功）或 `pending → failed`（达到最大重试次数仍未成功）。每次下载尝试时 `attempts` 递增；失败后仍保持 `pending` 状态等待下次重试，直到 `attempts` 达到上限（3 次）才标记为 `failed`。

---

## 4. RSS 拉取与增量更新

### Feed 注册（早期方案）

当前阶段通过一个声明式配置文件（JSON 或 YAML）管理 feed 列表。该文件作为 feed 注册的唯一入口（source of truth）。

每次调度周期启动时，系统读取配置文件并与 `feeds` 表做 diff：配置文件中存在但 `feeds` 表中没有的 URL，执行 INSERT 并设置 `next_fetch_at = NOW()`，使其立即参与本轮调度；`feeds` 表中存在但配置文件中已移除的 URL，暂不删除历史数据，仅跳过调度（不参与后续拉取）。

后续阶段将实现 Feed 管理 API，届时替换此配置文件机制。

### 调度机制

自有服务器上运行定时任务（`node-cron` 或系统 crontab），定期扫描 `feeds` 表，拉取所有 `next_fetch_at <= NOW()` 的 feed。默认拉取间隔可按 feed 活跃度单独配置，活跃源 15–30 分钟一次，低频源 1–2 小时一次。

当多个 feed 同时到达拉取时间时，需要限制并发。同一时刻最多并行拉取 5 个 feed，避免对自有服务器出口带宽造成压力，也避免短时间内向同一 RSS 源服务器发起过多请求。

### 条件请求

每次拉取时，HTTP 请求应携带上一次成功响应中的 `ETag`（通过 `If-None-Match` 头）和 `Last-Modified`（通过 `If-Modified-Since` 头），这两个值从 `feeds` 表中读取。

如果服务端返回 `304 Not Modified`，说明内容无变化，跳过后续所有解析和存储步骤，仅更新 `last_fetched_at` 和 `next_fetch_at`。

如果返回 `200`，将响应中的新 ETag 和 Last-Modified 值写回 `feeds` 表，然后进入解析流程。

**源不支持条件请求时的退化行为**：相当比例的 RSS 源不返回 ETag 或 Last-Modified。此时 `feeds` 表中对应字段为空，HTTP 请求不携带条件头，服务端每次都返回 200 + 完整 XML。系统对此无需特殊处理——全量解析后所有 items 走 `INSERT OR IGNORE`，已存在的记录被 SQLite 静默跳过，新 item 正常入库。整个流程是**幂等**的。条件请求本质上只是带宽优化（省掉一次 XML 传输和解析），对于 RSS feed 的数据量级（通常几十 KB 到几百 KB），这点开销完全可接受。

### 去重

通过 `items` 表上的 `UNIQUE(feed_id, guid)` 约束实现。每条解析出的 item 使用 `INSERT OR IGNORE` 插入——如果该 feed 下已存在相同 guid 的记录，SQLite 会静默跳过，不会报错也不需要预先查询。

### Batch 写入

同一个 feed 解析出的所有 items 应打包为一个 batch 请求发送给 Proxy Worker。这利用了 D1 batch 的事务语义（全部成功或全部回滚），同时将多次网络往返合并为一次，显著降低写入延迟。

---

## 5. 内容解析

### 技术选型

使用 Node.js 库 `rss-parser` 进行 RSS/Atom 解析，它能处理 RSS 2.0、Atom 1.0 以及 `content:encoded` 等常见扩展字段。对 HTML 内容的操作（提取图片 URL、resolve 相对路径等）使用 `cheerio`。

### 编码标准化（前置步骤）

RSS 源的编码不统一，尤其在中文互联网环境下，GB2312、GBK 等编码很常见。`rss-parser` 默认按 UTF-8 处理输入，非 UTF-8 内容会导致乱码或解析失败。因此，**编码转换必须在 RSS 解析之前完成**。

检测优先级如下：

1. HTTP 响应头 `Content-Type: text/xml; charset=xxx` 中的 charset 声明
2. XML 声明 `<?xml version="1.0" encoding="xxx"?>` 中的 encoding 属性
3. 若以上均未声明，使用自动检测库（`chardet` 或 `jschardet`）对响应 body 进行编码推断

检测到编码后，使用 `iconv-lite` 将原始 buffer 转换为 UTF-8 字符串，再交给 `rss-parser` 解析。注意：必须以 buffer 形式接收 HTTP 响应（而非让 HTTP 库自动按 UTF-8 decode），否则非 UTF-8 字节在第一次 decode 时就已经损坏，后续转换无法恢复。

### 解析规则

**content_html** 优先取 `content:encoded` 字段，若不存在则 fallback 到 `description`。存储时保留原始 HTML，不做纯文本提取——当前阶段只有一个用户，纯文本提取在后续 AI pipeline 中按需在线完成即可。

**pub_date** 在 RSS 规范中要求使用 RFC 822 格式，但实际来源的格式差异很大。`rss-parser` 会尝试自动解析，解析成功后统一转为 ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）存入数据库。如果解析失败，fallback 为当前抓取时间，并在日志中记录原始 pubDate 字符串以及对应的 feed URL 和 item title，方便后续排查和优化。

**相对 URL** 在部分 feed 的 content_html 中可能出现。在提取图片 URL 之前，需要以 feed 的 `<link>` 为 base URL，将所有相对路径 resolve 为绝对路径（`new URL(src, feedBaseUrl)`）。如果不处理，后续图片下载会因路径不完整而 404。

---

## 6. 图片处理

### 设计原则

图片处理与 item 入库是两个解耦的步骤。图片下载失败绝不阻塞 item 的存储——item 先入库，图片异步处理。content_html 保持 immutable，图片 URL 替换在读取时动态完成。

当前阶段优先保证数据完备性，图片以原始格式和尺寸保存，不做压缩或转码。存储成本参见第 9 节的用量预估。

### 流程

Item 入库后，使用 `cheerio` 解析其 content_html，提取所有 `<img>` 标签的 `src` 属性（此时相对 URL 已在解析阶段 resolve 为绝对路径）。每张图片在 `image_tasks` 表中创建一条 `pending` 记录。

随后异步执行下载：从原始 URL 拉取图片，上传至 R2，更新对应记录为 `success` 并写入 `r2_key`。下载或上传失败时 `attempts` 递增，记录 `last_error`，保持 `pending` 状态等待下次重试。当 `attempts` 达到 3 次仍未成功，状态置为 `failed`。

重试的查询条件：`SELECT * FROM image_tasks WHERE status = 'pending' AND attempts > 0 AND attempts < 3`。可以在每次 feed 拉取周期中顺带执行，也可以设置独立的重试调度。

### 图片 URL 的动态替换

读取 item 时，查询该 item 关联的所有 `status = 'success'` 的 image_tasks 记录，得到 `original_url → r2_key` 的映射关系。然后在 content_html 中执行字符串替换，将原始 URL 替换为 R2 的公开 URL。

`status` 为 `pending` 或 `failed` 的图片保留原始 URL 不动——客户端仍然可以尝试从原始源加载这些图片。

这个替换逻辑可以在客户端 API 层完成（不在本文档范围内），也可以作为一个独立的工具函数提供给任何需要渲染 content_html 的消费方。

### R2 Key 命名

```
images/{feed_id}/{item_guid_hash}/{index}.{ext}
```

其中 `item_guid_hash` 是 item guid 的 MD5 前 8 位，`index` 是图片在 HTML 中出现的顺序（从 0 开始），`ext` 从响应的 Content-Type 或 URL 后缀推断。

---

## 7. 原始 XML 备份

### 目的

尽管 RSS 内容解析后已存入 D1，但保留原始 XML 可以在解析逻辑出 bug、字段遗漏或数据损坏时用于数据恢复。这是一道廉价的安全网。

### 存储策略

每次拉取 RSS 时，如果 HTTP 响应不是 304（即有新内容返回），将完整的响应体原封不动地上传到 R2。不做任何解析、merge 或改写，确保备份是服务端返回的原始数据。

R2 Key 格式：

```
backups/{feed_id}/{ISO_8601_timestamp}.xml
```

示例：`backups/abc123/2026-02-18T08:30:00Z.xml`

### 保留期限

30 天。超过 30 天的 XML 备份自动清理。优先使用 R2 的 Object Lifecycle Rules 配置自动过期删除；如果 Lifecycle Rules 不满足需求，也可以在定时任务中手动扫描并删除过期文件。

### 恢复方式

如需恢复数据，按时间顺序读取某个 feed 的所有 XML 备份，逐个重新运行解析入库逻辑。由于 `items` 表有 `UNIQUE(feed_id, guid)` 约束，重复条目会被 `INSERT OR IGNORE` 自动跳过，无需担心重复导入。

---

## 8. 错误处理与容错

### RSS 拉取失败

当一次拉取因网络超时、DNS 解析失败、HTTP 5xx 等原因失败时，`consecutive_failures` 递增，并根据连续失败次数采用指数退避计算 `next_fetch_at`：失败 1 次等 30 分钟，失败 2 次等 1 小时，失败 3 次等 2 小时，上限封顶为 24 小时。一旦拉取成功，`consecutive_failures` 归零，恢复该 feed 的正常调度间隔。

建议设置告警阈值：当某个 feed 连续失败 10 次时，在日志中输出显著警告，提示人工检查该 feed 是否已永久失效或 URL 发生变更。

### XML 解析失败

如果 `rss-parser` 无法解析返回的内容（畸形 XML、编码错误、非 RSS 内容等），处理方式与拉取失败一致——走退避逻辑、递增 `consecutive_failures`。但有一个区别：即使解析失败，原始响应体仍然要备份到 R2。因为解析失败可能是我们的解析逻辑有 bug，而不是源数据有问题，保留原始数据便于后续排查和重新处理。

### 图片下载失败

见第 6 节。核心原则是图片下载与 item 入库完全解耦，通过 `image_tasks` 表独立管理生命周期和重试。

### D1 / R2 写入失败

D1 或 R2 的写入失败属于基础设施层面的故障，不应静默忽略。处理策略：记录完整错误日志（包括请求参数和响应内容），当次任务中止且不更新 `last_fetched_at`，确保下一个调度周期会重新处理该 feed。不做即时自动重试，避免在基础设施故障期间反复请求加重问题。

### Proxy Worker 故障

Proxy Worker 不可用时（返回 5xx 或超时），视同 D1 写入失败处理——中止当次任务，下个周期重试。Proxy Worker 本身是无状态的，Cloudflare 会自动处理其部署和可用性，不需要我们额外做健康检查。

### pubDate 解析失败

Fallback 到当前抓取时间（`new Date().toISOString()`），并在日志中记录原始 pubDate 字符串、feed URL 和 item title。这些信息可以帮助后续识别格式模式，逐步完善解析逻辑。

---

## 9. 数据生命周期管理

### 保留策略

| 数据类型 | 保留期限 | 清理机制 |
|---------|---------|---------|
| XML 备份 | 30 天 | R2 Object Lifecycle Rules 自动过期 |
| Items + 关联图片 | 180 天（可配置） | 定时任务级联清理 |

XML 备份保留 30 天足够用于数据恢复。Items 和图片保留期更长（默认 180 天），因为下游 AI pipeline 可能需要较长时间窗口的历史数据来做跨源分析和去重。保留天数作为可配置参数，方便后续根据实际存储用量调整。

### 级联清理流程

Items 和图片以 item 为单位做级联清理，由自有服务器上的定时任务执行（建议每天一次，低峰时段运行）：

1. **查询过期 items**：`SELECT id FROM items WHERE created_at < datetime('now', '-180 days')`
2. **收集关联的 R2 keys**：查询这批 item_ids 对应的 image_tasks 中所有 `status = 'success'` 的 `r2_key`
3. **批量删除 R2 对象**：通过 S3 API 的 `DeleteObjects` 操作删除图片文件（单次最多 1000 个对象）
4. **删除 image_tasks 记录**：删除这批 item_ids 对应的所有 image_tasks 行（包括 `failed` 和 `pending` 状态的）
5. **删除 items 记录**：删除过期的 items 行

步骤 4 和 5 应打包为一个 batch 请求发送给 Proxy Worker，利用事务语义保证原子性。步骤 3（R2 删除）是独立的 API 调用，如果 R2 删除失败但 D1 删除成功，会产生 R2 中的孤儿对象；反过来如果 D1 删除失败但 R2 已删除，会导致 image_tasks 指向不存在的 R2 key。建议执行顺序为 R2 先删、D1 后删——孤儿对象浪费一点存储但无功能影响，而 dangling reference 会导致客户端 404。

### 存储用量预估

假设 50 个 feed，平均每 feed 每天 10 条 item，每条 item 平均 3 张图片（平均 200KB/张）：

- Items 表：50 × 10 × 180 = 90,000 行（180 天），D1 免费层 5GB 存储绰绰有余
- 图片存储：50 × 10 × 3 × 0.2MB × 30 ≈ 9GB（首月），180 天约 54GB
- R2 免费层提供 10GB，超出部分按 $0.015/GB/月 计费

首月图片存储量约 9GB，在 R2 免费层范围内。第二个月开始超出免费层，半年后约 50GB，月度额外成本不到 $1。当前阶段优先保证数据完备性（为下游 AI pipeline 提供充分的原始数据），存储成本在可接受范围内。如果后续用量增长超预期，可考虑的降级手段包括：缩短图片保留期限、对低优先级 feed 跳过图片下载、引入图片压缩。

---

## 附录 A. 技术选型汇总

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js | 主语言 |
| RSS 解析 | `rss-parser` | 支持 RSS 2.0、Atom、`content:encoded` |
| HTML 解析 | `cheerio` | 提取图片 URL、resolve 相对路径 |
| 编码检测 | `chardet` / `jschardet` | 自动检测非 UTF-8 编码 |
| 编码转换 | `iconv-lite` | 将非 UTF-8 内容转为 UTF-8 |
| 数据库代理 | Cloudflare Worker | Proxy Worker，暴露 query/batch/exec endpoint |
| 结构化存储 | Cloudflare D1 | 通过 Proxy Worker 的 Binding API 访问 |
| 文件存储 | Cloudflare R2 | 通过 S3 兼容 API 直接访问 |
| 定时调度 | `node-cron` 或系统 crontab | 运行在自有服务器上 |

## 附录 B. R2 Key 命名规范

```
images/{feed_id}/{item_guid_hash}/{index}.{ext}    # 图片文件
backups/{feed_id}/{ISO_8601_timestamp}.xml          # XML 备份
```