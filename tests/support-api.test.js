'use strict';

const assert = require('node:assert/strict');

const authPath = require.resolve('../lib/site-auth');
const storePath = require.resolve('../lib/support-store');
const auditPath = require.resolve('../lib/audit-store');
let updateInput;

require.cache[authPath] = {
  id:authPath, filename:authPath, loaded:true,
  exports:{ authorizeSite:async () => ({ ok:true, siteId:'demo-store', userId:'user_1' }) }
};
require.cache[storePath] = {
  id:storePath, filename:storePath, loaded:true,
  exports:{
    listCases:async () => [],
    supportSummary:async () => ({ active_cases:3, priority_cases:2, overdue_cases:1 }),
    adminCase:async () => ({ case:{ id:'case-1' }, messages:[] }),
    updateCase:async (input) => { updateInput = input; return { case:{ id:input.caseId, status:'assigned', priority:input.priority }, messages:[] }; }
  }
};
require.cache[auditPath] = {
  id:auditPath, filename:auditPath, loaded:true,
  exports:{ recordAudit:async () => {} }
};

const support = require('../api/admin/support');

function response() {
  return {
    headers:{}, statusCode:0, body:null,
    setHeader(name, value) { this.headers[name] = value; },
    end(raw) { this.body = JSON.parse(raw); }
  };
}

(async () => {
  const summary = response();
  await support({ method:'GET', query:{ site:'demo-store', summary:'1' } }, summary);
  assert.equal(summary.statusCode, 200);
  assert.deepEqual(summary.body.summary, { active_cases:3, priority_cases:2, overdue_cases:1 });

  const updated = response();
  await support({ method:'POST', body:{ siteId:'demo-store', caseId:'case-1', action:'set_priority', priority:'urgent' } }, updated);
  assert.equal(updated.statusCode, 200);
  assert.equal(updateInput.priority, 'urgent');
  assert.equal(updateInput.userId, 'user_1');
  console.log('support API tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
