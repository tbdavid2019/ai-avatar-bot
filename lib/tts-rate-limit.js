'use strict';

const localHits = new Map();
let sqlClient;
let schemaPromise;

function requiresDistributedStore() {
  return String(process.env.TTS_REQUIRE_DISTRIBUTED_LIMIT || '').toLowerCase() === 'true'
    || String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function databaseError() {
  return Object.assign(new Error('TTS 分散式限流尚未設定。'), { status:503, code:'TTS_RATE_LIMIT_NOT_CONFIGURED' });
}

async function getSql() {
  if (!process.env.DATABASE_URL) throw databaseError();
  if (!sqlClient) {
    const { neon } = await import('@neondatabase/serverless');
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const sql = await getSql();
    await sql`
      CREATE TABLE IF NOT EXISTS tts_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        hits INTEGER NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;
  })().catch((error) => { schemaPromise = null; throw error; });
  return schemaPromise;
}

function consumeLocal(key, limit, now) {
  let item = localHits.get(key);
  if (!item || now >= item.expiresAt) item = { hits:0, expiresAt:now + 120000 };
  item.hits++;
  localHits.set(key, item);
  if (localHits.size > 5000) for (const [storedKey, value] of localHits) if (now >= value.expiresAt) localHits.delete(storedKey);
  return item.hits <= limit;
}

async function consume(key, limit) {
  key = String(key || '').slice(0, 160);
  limit = Math.max(1, Number(limit) || 1);
  if (!process.env.DATABASE_URL) {
    if (requiresDistributedStore()) throw databaseError();
    return consumeLocal(key, limit, Date.now());
  }
  await ensureSchema();
  const sql = await getSql();
  const rows = await sql.query(
    `INSERT INTO tts_rate_limits (bucket_key, hits, expires_at)
       VALUES ($1, 1, NOW() + INTERVAL '120 seconds')
     ON CONFLICT (bucket_key) DO UPDATE
       SET hits = CASE WHEN tts_rate_limits.expires_at <= NOW() THEN 1 ELSE tts_rate_limits.hits + 1 END,
           expires_at = CASE WHEN tts_rate_limits.expires_at <= NOW() THEN NOW() + INTERVAL '120 seconds' ELSE tts_rate_limits.expires_at END
       WHERE tts_rate_limits.expires_at <= NOW() OR tts_rate_limits.hits < $2
     RETURNING hits`,
    [key, limit]
  );
  return Boolean(rows[0]);
}

module.exports = { consume, ensureSchema, requiresDistributedStore };
