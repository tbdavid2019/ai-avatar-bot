'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
for (const file of ['lib/analytics-store.js', 'lib/support-store.js', 'lib/lead-store.js', 'lib/audit-store.js']) {
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8').includes('Math.random'), false, file + ' must not use probabilistic retention cleanup');
}

const retentionPath = require.resolve('../lib/retention-store');
let called = false;
require.cache[retentionPath] = {
  id:retentionPath, filename:retentionPath, loaded:true,
  exports:{ runRetentionCleanup:async () => { called = true; return { cleaned:true }; } },
};
const cron = require('../api/cron/retention');

function response() {
  return {
    headers:{}, statusCode:0, body:null,
    setHeader(name, value) { this.headers[name] = value; },
    end(raw) { this.body = JSON.parse(raw); },
  };
}

(async () => {
  process.env.CRON_SECRET = 'retention-secret';
  const denied = response();
  await cron({ method:'GET', headers:{} }, denied);
  assert.equal(denied.statusCode, 401);

  const accepted = response();
  await cron({ method:'GET', headers:{ authorization:'Bearer retention-secret' } }, accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(called, true);
  console.log('retention tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
