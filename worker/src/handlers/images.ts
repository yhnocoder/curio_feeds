export async function insertImageTasks(
  db: D1Database,
  params: { tasks: { id: string; itemId: string; originalUrl: string; createdAt: string }[] }
): Promise<void> {
  if (params.tasks.length === 0) return;
  const stmts = params.tasks.map((t) =>
    db.prepare(
      `INSERT OR IGNORE INTO image_tasks (id, item_id, original_url, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?)`
    ).bind(t.id, t.itemId, t.originalUrl, t.createdAt, t.createdAt)
  );
  await db.batch(stmts);
}

export async function markImageSuccess(
  db: D1Database,
  params: { itemId: string; originalUrl: string; r2Key: string; now: string }
): Promise<void> {
  await db.prepare(
    `UPDATE image_tasks
     SET status = 'success', r2_key = ?, attempts = attempts + 1, updated_at = ?
     WHERE item_id = ? AND original_url = ?`
  ).bind(params.r2Key, params.now, params.itemId, params.originalUrl).run();
}

export async function markImageFailure(
  db: D1Database,
  params: { itemId: string; originalUrl: string; error: string; now: string; maxAttempts: number }
): Promise<void> {
  await db.prepare(
    `UPDATE image_tasks
     SET attempts = attempts + 1,
         last_error = ?,
         status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
         updated_at = ?
     WHERE item_id = ? AND original_url = ?`
  ).bind(params.error, params.maxAttempts, params.now, params.itemId, params.originalUrl).run();
}

export async function getPendingImageRetries(
  db: D1Database,
  params: { maxAttempts: number }
): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    `SELECT it.id, it.item_id, it.original_url
     FROM image_tasks it
     WHERE it.status = 'pending' AND it.attempts > 0 AND it.attempts < ?`
  ).bind(params.maxAttempts).all();
  return result.results;
}

export async function getImageTaskUrls(
  db: D1Database,
  params: { itemId: string }
): Promise<{ original_url: string }[]> {
  const result = await db.prepare(
    "SELECT original_url FROM image_tasks WHERE item_id = ? ORDER BY created_at"
  ).bind(params.itemId).all<{ original_url: string }>();
  return result.results;
}
