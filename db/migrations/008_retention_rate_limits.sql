CREATE TABLE IF NOT EXISTS tts_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS tts_rate_limits_expires_idx
  ON tts_rate_limits (expires_at);
