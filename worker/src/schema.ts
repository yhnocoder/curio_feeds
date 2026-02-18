// D1 schema migration SQL
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  last_etag TEXT,
  last_modified TEXT,
  last_fetched_at TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  next_fetch_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  link TEXT,
  title TEXT,
  pub_date TEXT,
  content_html TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(feed_id, guid),
  FOREIGN KEY (feed_id) REFERENCES feeds(id)
);

CREATE TABLE IF NOT EXISTS image_tasks (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX IF NOT EXISTS idx_items_feed_id ON items(feed_id);
CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_image_tasks_item_id ON image_tasks(item_id);
CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_tasks(status, attempts);
`;
