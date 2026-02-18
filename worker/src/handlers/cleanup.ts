export async function getImageR2Keys(
  db: D1Database,
  params: { itemIds: string[] }
): Promise<string[]> {
  if (params.itemIds.length === 0) return [];
  const placeholders = params.itemIds.map(() => "?").join(",");
  const result = await db.prepare(
    `SELECT r2_key FROM image_tasks
     WHERE item_id IN (${placeholders}) AND status = 'success' AND r2_key IS NOT NULL`
  ).bind(...params.itemIds).all<{ r2_key: string }>();
  return result.results.map((r) => r.r2_key);
}

export async function deleteExpiredRecords(
  db: D1Database,
  params: { itemIds: string[] }
): Promise<void> {
  if (params.itemIds.length === 0) return;
  const placeholders = params.itemIds.map(() => "?").join(",");
  await db.batch([
    db.prepare(`DELETE FROM image_tasks WHERE item_id IN (${placeholders})`).bind(...params.itemIds),
    db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).bind(...params.itemIds),
  ]);
}
