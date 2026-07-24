'use strict';

const crypto = require('node:crypto');
const { json, methodNotAllowed } = require('../../lib/http');
const { runRetentionCleanup } = require('../../lib/retention-store');

function authorized(req) {
  const expected = String(process.env.CRON_SECRET || '');
  const received = String(req.headers && req.headers.authorization || '');
  if (!expected || !received.startsWith('Bearer ')) return false;
  const actual = received.slice(7).trim();
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!authorized(req)) return json(res, 401, { error:'unauthorized' });
  try {
    return json(res, 200, await runRetentionCleanup());
  } catch (error) {
    console.error('[retention cleanup]', error && error.message || error);
    return json(res, 503, { error:'retention cleanup failed' });
  }
};
