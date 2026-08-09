CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  url TEXT,
  source TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_created ON usage_logs(user_id, created_at);
