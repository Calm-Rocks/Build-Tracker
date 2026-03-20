CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  attempts INTEGER DEFAULT 1,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (key)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  email TEXT,
  ip TEXT,
  user_id INTEGER,
  meta TEXT,
  created_at INTEGER NOT NULL
);