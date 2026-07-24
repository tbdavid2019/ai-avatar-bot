'use strict';

let sqlClient;

function databaseError() {
  return Object.assign(new Error('永久資料庫尚未設定。'), { status:503, code:'DATABASE_NOT_CONFIGURED' });
}

async function getSql() {
  if (!process.env.DATABASE_URL) throw databaseError();
  if (!sqlClient) {
    const { neon } = await import('@neondatabase/serverless');
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

function days(name, fallback, min, max) {
  return Math.max(min, Math.min(Number(process.env[name]) || fallback, max));
}

function retentionConfig() {
  return {
    analytics:days('ANALYTICS_RETENTION_DAYS', 180, 7, 730),
    support:days('SUPPORT_RETENTION_DAYS', 365, 30, 1825),
    leads:days('LEADS_RETENTION_DAYS', 365, 30, 1825),
    audit:days('AUDIT_RETENTION_DAYS', 365, 30, 2555),
  };
}

async function deleteExpired(sql, statement, params) {
  try {
    const rows = await sql.query(statement, params);
    return Number(rows && rows[0] && rows[0].count) || 0;
  } catch (error) {
    // A new deployment may run the cron before a feature has ever initialized
    // its table. Treat that as an empty table; other database errors surface.
    if (String(error && error.code) === '42P01') return 0;
    throw error;
  }
}

async function runRetentionCleanup() {
  const sql = await getSql();
  const config = retentionConfig();
  const [analytics, support, leads, audit, tts] = await Promise.all([
    deleteExpired(sql, `WITH removed AS (
      DELETE FROM analytics_events WHERE created_at < NOW() - ($1::text || ' days')::interval RETURNING id
    ) SELECT COUNT(*)::int AS count FROM removed`, [config.analytics]),
    deleteExpired(sql, `WITH removed AS (
      DELETE FROM support_cases WHERE status = 'resolved' AND resolved_at < NOW() - ($1::text || ' days')::interval RETURNING id
    ) SELECT COUNT(*)::int AS count FROM removed`, [config.support]),
    deleteExpired(sql, `WITH removed AS (
      DELETE FROM leads WHERE created_at < NOW() - ($1::text || ' days')::interval RETURNING id
    ) SELECT COUNT(*)::int AS count FROM removed`, [config.leads]),
    deleteExpired(sql, `WITH removed AS (
      DELETE FROM admin_audit_log WHERE created_at < NOW() - ($1::text || ' days')::interval RETURNING id
    ) SELECT COUNT(*)::int AS count FROM removed`, [config.audit]),
    deleteExpired(sql, `WITH removed AS (
      DELETE FROM tts_rate_limits WHERE expires_at < NOW() RETURNING bucket_key
    ) SELECT COUNT(*)::int AS count FROM removed`, []),
  ]);
  return { config, deleted:{ analytics, support, leads, audit, tts } };
}

module.exports = { retentionConfig, runRetentionCleanup };
