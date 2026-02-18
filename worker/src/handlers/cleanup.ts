export async function deleteExpiredRecords(
  db: D1Database,
  params: { itemIds: string[] }
): Promise<void> {
  if (params.itemIds.length === 0) return;
  const placeholders = params.itemIds.map(() => "?").join(",");
  await db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).bind(...params.itemIds).run();
}

// 清理已标记软删除的 feed 及其关联数据
export async function deleteMarkedFeeds(db: D1Database): Promise<number> {
  const marked = await db.prepare(
    "SELECT id FROM feeds WHERE deleted_at IS NOT NULL"
  ).all<{ id: string }>();

  if (marked.results.length === 0) return 0;

  const stmts: D1PreparedStatement[] = [];
  for (const feed of marked.results) {
    stmts.push(
      db.prepare("DELETE FROM feed_group_members WHERE feed_id = ?").bind(feed.id),
      db.prepare("DELETE FROM items WHERE feed_id = ?").bind(feed.id),
      db.prepare("DELETE FROM feeds WHERE id = ?").bind(feed.id),
    );
  }
  await db.batch(stmts);

  return marked.results.length;
}
