PRAGMA foreign_keys = ON;

CREATE TABLE participation_slots (
  id TEXT PRIMARY KEY,
  stream_date TEXT NOT NULL UNIQUE,
  stream_time TEXT NOT NULL DEFAULT '20:00',
  time_zone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  previous_game TEXT NOT NULL,
  next_game TEXT NOT NULL,
  special_topic TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'pending', 'confirmed')),
  confirmed_request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE participation_requests (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES participation_slots(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'waitlisted', 'confirmed', 'rejected', 'canceled')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  bears_story TEXT NOT NULL,
  song_title TEXT NOT NULL,
  song_artist TEXT NOT NULL,
  song_reason TEXT NOT NULL,
  rules_accepted_at TEXT NOT NULL,
  privacy_accepted_at TEXT NOT NULL,
  publication_accepted_at TEXT NOT NULL,
  request_acknowledged_at TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'partial', 'failed')),
  participant_email_id TEXT,
  admin_email_id TEXT,
  decision_email_status TEXT CHECK (decision_email_status IS NULL OR decision_email_status IN ('sent', 'failed')),
  decision_email_id TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX participation_requests_slot_status ON participation_requests(slot_id, status);
CREATE INDEX participation_requests_submitted_at ON participation_requests(submitted_at DESC);
CREATE UNIQUE INDEX one_confirmed_request_per_slot ON participation_requests(slot_id) WHERE status = 'confirmed';
CREATE UNIQUE INDEX one_active_request_per_email_slot ON participation_requests(slot_id, email) WHERE status IN ('pending', 'waitlisted', 'confirmed');

INSERT INTO participation_slots (id, stream_date, previous_game, next_game, special_topic) VALUES
  ('2026-09-16', '2026-09-16', 'Bears @ Carolina Panthers — 13 sep', 'Minnesota Vikings @ Bears — 20 sep', NULL),
  ('2026-09-23', '2026-09-23', 'Minnesota Vikings @ Bears — 20 sep', 'Philadelphia Eagles @ Bears — 28 sep', NULL),
  ('2026-09-30', '2026-09-30', 'Philadelphia Eagles @ Bears — 28 sep', 'New York Jets @ Bears — 4 oct', NULL),
  ('2026-10-07', '2026-10-07', 'New York Jets @ Bears — 4 oct', 'Bears @ Green Bay Packers — 11 oct', NULL),
  ('2026-10-14', '2026-10-14', 'Bears @ Green Bay Packers — 11 oct', 'Bears @ Atlanta Falcons — 18 oct', NULL),
  ('2026-10-21', '2026-10-21', 'Bears @ Atlanta Falcons — 18 oct', 'New England Patriots @ Bears — 22 oct', NULL),
  ('2026-10-28', '2026-10-28', 'New England Patriots @ Bears — 22 oct', 'Bears @ Seattle Seahawks — 2 nov', NULL),
  ('2026-11-04', '2026-11-04', 'Bears @ Seattle Seahawks — 2 nov', 'Tampa Bay Buccaneers @ Bears — 8 nov', NULL),
  ('2026-11-11', '2026-11-11', 'Tampa Bay Buccaneers @ Bears — 8 nov', 'BYE — semana de descanso', 'Evaluación de media temporada, objetivos y desempeño'),
  ('2026-11-25', '2026-11-25', 'New Orleans Saints @ Bears — 22 nov', 'Bears @ Detroit Lions — 26 nov', NULL),
  ('2026-12-02', '2026-12-02', 'Bears @ Detroit Lions — 26 nov', 'Jacksonville Jaguars @ Bears — 6 dic', NULL),
  ('2026-12-09', '2026-12-09', 'Jacksonville Jaguars @ Bears — 6 dic', 'Bears @ Miami Dolphins — 13 dic', NULL),
  ('2026-12-16', '2026-12-16', 'Bears @ Miami Dolphins — 13 dic', 'Bears @ Buffalo Bills — 19 dic', NULL),
  ('2026-12-23', '2026-12-23', 'Bears @ Buffalo Bills — 19 dic', 'Green Bay Packers @ Bears — 25 dic', NULL),
  ('2026-12-30', '2026-12-30', 'Green Bay Packers @ Bears — 25 dic', 'Detroit Lions @ Bears — 3 ene', NULL),
  ('2027-01-06', '2027-01-06', 'Detroit Lions @ Bears — 3 ene', 'Bears @ Minnesota Vikings — fecha por definir', NULL);
