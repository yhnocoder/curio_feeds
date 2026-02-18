export async function listFeedUrls(db: D1Database): Promise<string[]> {
  const result = await db.prepare("SELECT url FROM feeds").all<{ url: string }>();
  return result.results.map((r) => r.url);
}

export async function insertFeeds(
  db: D1Database,
  params: { feeds: { id: string; url: string; nextFetchAt: string; createdAt: string }[] }
): Promise<void> {
  if (params.feeds.length === 0) return;
  const stmts = params.feeds.map((f) =>
    db.prepare("INSERT INTO feeds (id, url, next_fetch_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(f.id, f.url, f.nextFetchAt, f.createdAt)
  );
  await db.batch(stmts);
}

export async function getDueFeeds(
  db: D1Database,
  params: { now: string }
): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    `SELECT id, url, last_etag, last_modified, consecutive_failures
     FROM feeds
     WHERE next_fetch_at <= ? OR next_fetch_at IS NULL`
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
