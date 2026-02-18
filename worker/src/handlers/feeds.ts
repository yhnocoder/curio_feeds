// -- Feed 查询/状态更新 --

export async function addFeed(
  db: D1Database,
  params: { id: string; url: string; intervalMinutes: number | null; nextFetchAt: string; createdAt: string }
): Promise<Record<string, unknown>> {
  await db.prepare(
    `INSERT INTO feeds (id, url, interval_minutes, next_fetch_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(params.id, params.url, params.intervalMinutes, params.nextFetchAt, params.createdAt).run();

  const row = await db.prepare("SELECT * FROM feeds WHERE id = ?").bind(params.id).first();
  return row as Record<string, unknown>;
}

export async function softDeleteFeed(
  db: D1Database,
  params: { id: string; now: string }
): Promise<void> {
  await db.prepare("UPDATE feeds SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(params.now, params.id).run();
}

export async function listFeeds(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db.prepare("SELECT * FROM feeds WHERE deleted_at IS NULL").all();
  return result.results;
}

export async function getDueFeeds(
  db: D1Database,
  params: { now: string }
): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    `SELECT id, url, last_etag, last_modified, consecutive_failures
     FROM feeds
     WHERE deleted_at IS NULL AND (next_fetch_at <= ? OR next_fetch_at IS NULL)`
  ).bind(params.now).all();
  return result.results;
}

export async function markFeedNotModified(
  db: D1Database,
  params: { id: string; now: string; nextFetchAt: string }
): Promise<void> {
  await db.prepare(
    `UPDATE feeds SET last_fetched_at = ?, next_fetch_at = ?, consecutive_failures = 0
     WHERE id = ?`
  ).bind(params.now, params.nextFetchAt, params.id).run();
}

export async function markFeedSuccess(
  db: D1Database,
  params: { id: string; title: string | null; etag: string | null; lastModified: string | null; now: string; nextFetchAt: string }
): Promise<void> {
  await db.prepare(
    `UPDATE feeds SET
       title = COALESCE(?, title),
       last_etag = ?,
       last_modified = ?,
       last_fetched_at = ?,
       next_fetch_at = ?,
       consecutive_failures = 0
     WHERE id = ?`
  ).bind(params.title, params.etag, params.lastModified, params.now, params.nextFetchAt, params.id).run();
}

export async function markFeedFailure(
  db: D1Database,
  params: { id: string; failures: number; nextFetchAt: string }
): Promise<void> {
  await db.prepare(
    "UPDATE feeds SET consecutive_failures = ?, next_fetch_at = ? WHERE id = ?"
  ).bind(params.failures, params.nextFetchAt, params.id).run();
}
