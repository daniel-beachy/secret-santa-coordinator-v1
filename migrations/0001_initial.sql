CREATE TABLE exchanges (
  id TEXT PRIMARY KEY,
  admin_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reset_at TEXT,
  restored_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'reset'))
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  exchange_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  FOREIGN KEY (exchange_id) REFERENCES exchanges(id) ON DELETE CASCADE,
  UNIQUE (exchange_id, name_key)
);

CREATE INDEX participants_exchange_name
  ON participants(exchange_id, name_key);

CREATE TABLE exchange_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'reset', 'restored')),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (exchange_id) REFERENCES exchanges(id) ON DELETE CASCADE
);

CREATE INDEX exchange_events_exchange_time
  ON exchange_events(exchange_id, occurred_at);
