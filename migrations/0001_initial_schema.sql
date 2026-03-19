CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  emoji TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  client_id TEXT DEFAULT '',
  parent_build_id TEXT DEFAULT '',
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  demo_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  milestones TEXT DEFAULT '[]',
  tweaks TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);