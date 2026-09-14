CREATE TABLE IF NOT EXISTS supporters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  visitor_hash TEXT NOT NULL UNIQUE,
  ip_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supporters_status_created ON supporters(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supporters_ip_updated ON supporters(ip_hash, updated_at DESC);
PRAGMA optimize;
