export async function deleteExpiredRecords(
  db: D1Database,
  params: { itemIds: string[] }
): Promise<void> {
  if (params.itemIds.length === 0) return;
  const placeholders = params.itemIds.map(() => "?").join(",");
  await db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).bind(...params.itemIds).run();
}
