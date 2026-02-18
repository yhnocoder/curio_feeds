// -- FeedGroup CRUD --

export async function createGroup(
  db: D1Database,
  params: { id: string; name: string; createdAt: string }
): Promise<Record<string, unknown>> {
  await db.prepare(
    "INSERT INTO feed_groups (id, name, created_at) VALUES (?, ?, ?)"
  ).bind(params.id, params.name, params.createdAt).run();

  return { id: params.id, name: params.name, created_at: params.createdAt };
}

export async function deleteGroup(
  db: D1Database,
  params: { id: string }
): Promise<void> {
  // 先删关联，再删 group
  await db.batch([
    db.prepare("DELETE FROM feed_group_members WHERE group_id = ?").bind(params.id),
    db.prepare("DELETE FROM feed_groups WHERE id = ?").bind(params.id),
  ]);
}

export async function listGroups(
  db: D1Database
): Promise<{ id: string; name: string; created_at: string; feed_ids: string[] }[]> {
  const groups = await db.prepare("SELECT * FROM feed_groups").all<{ id: string; name: string; created_at: string }>();
  const members = await db.prepare("SELECT group_id, feed_id FROM feed_group_members").all<{ group_id: string; feed_id: string }>();

  // 按 group_id 聚合 feed_ids
  const memberMap = new Map<string, string[]>();
  for (const m of members.results) {
    const list = memberMap.get(m.group_id) ?? [];
    list.push(m.feed_id);
    memberMap.set(m.group_id, list);
  }

  return groups.results.map((g) => ({
    ...g,
    feed_ids: memberMap.get(g.id) ?? [],
  }));
}

export async function addFeedToGroup(
  db: D1Database,
  params: { groupId: string; feedId: string; createdAt: string }
): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO feed_group_members (group_id, feed_id, created_at) VALUES (?, ?, ?)"
  ).bind(params.groupId, params.feedId, params.createdAt).run();
}

export async function removeFeedFromGroup(
  db: D1Database,
  params: { groupId: string; feedId: string }
): Promise<void> {
  await db.prepare(
    "DELETE FROM feed_group_members WHERE group_id = ? AND feed_id = ?"
  ).bind(params.groupId, params.feedId).run();
}
