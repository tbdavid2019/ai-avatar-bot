'use strict';

const assert = require('node:assert/strict');
const {
  issueToken,
  verifyToken,
  allowedOrigin,
} = require('../lib/tts-security');

process.env.TTS_TOKEN_SECRET = 'test-only-tts-secret-with-32-bytes!';
process.env.TTS_ALLOWED_ORIGINS = 'https://widget.example, http://localhost:3000';

assert.equal(allowedOrigin('https://widget.example'), true);
assert.equal(allowedOrigin('https://attacker.example'), false);

const token = issueToken('https://widget.example', 60);
assert.equal(typeof token, 'string');
const claims = verifyToken(token, 'https://widget.example');
assert.equal(claims.origin, 'https://widget.example');
assert.equal(verifyToken(token, 'https://attacker.example'), null);

const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
assert.equal(verifyToken(tampered, 'https://widget.example'), null);

const expired = issueToken('https://widget.example', 30);
const now = Date.now;
Date.now = () => now() + 31 * 1000;
assert.equal(verifyToken(expired, 'https://widget.example'), null);
Date.now = now;

const tts = require('../api/tts');
function response() {
  return {
    headers:{}, statusCode:0, body:'',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value || ''); },
  };
}
(async () => {
  const unauthorised = response();
  await tts({ method:'POST', headers:{ origin:'https://widget.example', host:'attacker.example', 'x-forwarded-for':'127.0.0.1' }, body:{} }, unauthorised);
  assert.equal(unauthorised.statusCode, 401);

  const missingOrigin = response();
  await tts({ method:'POST', headers:{ host:'widget.example' }, body:{} }, missingOrigin);
  assert.equal(missingOrigin.statusCode, 403);
  console.log('tts API security tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
