export async function insertItems(
  db: D1Database,
  params: {
    items: {
      id: string; feedId: string; guid: string; link: string | null;
      title: string | null; pubDate: string | null; contentHtml: string | null; createdAt: string;
    }[];
  }
): Promise<void> {
  if (params.items.length === 0) return;
  const stmts = params.items.map((item) =>
    db.prepare(
      `INSERT OR IGNORE INTO items (id, feed_id, guid, link, title, pub_date, content_html, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(item.id, item.feedId, item.guid, item.link, item.title, item.pubDate, item.contentHtml, item.createdAt)
  );
  await db.batch(stmts);
}

export async function getItemFeedInfo(
  db: D1Database,
  params: { itemId: string }
): Promise<Record<string, unknown> | null> {
  const result = await db.prepare(
    "SELECT feed_id, guid FROM items WHERE id = ?"
  ).bind(params.itemId).first();
  return result as Record<string, unknown> | null;
}

export async function getExpiredItemIds(
  db: D1Database,
  params: { retentionDays: number }
): Promise<string[]> {
  const result = await db.prepare(
    `SELECT id FROM items WHERE created_at < datetime('now', '-' || ? || ' days')`
  ).bind(params.retentionDays).all<{ id: string }>();
  return result.results.map((r) => r.id);
}
