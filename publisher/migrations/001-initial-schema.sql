CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  current_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (current_revision_id) REFERENCES revisions(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'ready', 'superseded')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  season INTEGER NOT NULL CHECK (season BETWEEN 2000 AND 2100),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  featured_image_json TEXT NOT NULL CHECK (json_valid(featured_image_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE RESTRICT,
  UNIQUE (article_id, revision_number)
) STRICT;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('translation', 'audio', 'image', 'audiogram')),
  locale TEXT CHECK (locale IN ('es', 'en')),
  dependency_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'generated', 'reviewed', 'accepted', 'superseded', 'failed')),
  path TEXT,
  checksum_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON DELETE RESTRICT,
  CHECK ((status IN ('accepted', 'reviewed', 'generated') AND path IS NOT NULL AND checksum_sha256 IS NOT NULL)
      OR status IN ('pending', 'superseded', 'failed'))
) STRICT;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('translation', 'tts_es', 'tts_en', 'audiogram', 'release', 'deployment', 'music_release')),
  revision_id TEXT,
  artifact_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  dependency_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'retry_wait', 'completed', 'failed', 'cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  error_code TEXT,
  error_message TEXT,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT,
  CHECK (status != 'leased' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
) STRICT;

CREATE TABLE article_catalogs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE article_catalog_entries (
  catalog_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (catalog_id, article_id),
  UNIQUE (catalog_id, position),
  FOREIGN KEY (catalog_id) REFERENCES article_catalogs(id) ON DELETE RESTRICT,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE RESTRICT,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE site_settings_revisions (
  id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL,
  site_settings_revision_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'validated', 'failed')),
  path TEXT NOT NULL UNIQUE,
  manifest_json TEXT CHECK (manifest_json IS NULL OR json_valid(manifest_json)),
  manifest_checksum_sha256 TEXT,
  created_at TEXT NOT NULL,
  validated_at TEXT,
  error_message TEXT,
  FOREIGN KEY (catalog_id) REFERENCES article_catalogs(id) ON DELETE RESTRICT,
  FOREIGN KEY (site_settings_revision_id) REFERENCES site_settings_revisions(id) ON DELETE RESTRICT,
  CHECK (status != 'validated' OR (manifest_json IS NOT NULL AND manifest_checksum_sha256 IS NOT NULL AND validated_at IS NOT NULL))
) STRICT;

CREATE TABLE release_artifacts (
  release_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  PRIMARY KEY (release_id, artifact_id),
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE RESTRICT,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'uploading', 'verifying', 'published', 'failed', 'rolled_back')),
  cloudflare_deployment_id TEXT,
  immutable_url TEXT,
  verification_json TEXT CHECK (verification_json IS NULL OR json_valid(verification_json)),
  previous_deployment_id TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  finished_at TEXT,
  error_message TEXT,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE RESTRICT,
  CHECK (status != 'published' OR (cloudflare_deployment_id IS NOT NULL AND immutable_url IS NOT NULL AND published_at IS NOT NULL))
) STRICT;

CREATE INDEX artifacts_revision_status_idx ON artifacts(revision_id, status);
CREATE INDEX artifacts_dependency_idx ON artifacts(type, locale, dependency_hash);
CREATE INDEX jobs_claim_idx ON jobs(status, available_at, lease_expires_at);
CREATE INDEX jobs_revision_idx ON jobs(revision_id, type);
CREATE INDEX releases_status_idx ON releases(status, created_at);
CREATE INDEX deployments_release_idx ON deployments(release_id, created_at);
