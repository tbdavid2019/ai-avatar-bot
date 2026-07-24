'use strict';

const { json, methodNotAllowed } = require('../lib/http');
const { allowedOrigin, issueToken, requestOrigin } = require('../lib/tts-security');
const { consume } = require('../lib/tts-rate-limit');

module.exports = async (req, res) => {
  const origin = requestOrigin(req);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!allowedOrigin(origin)) return json(res, 403, { error:'TTS 來源未獲允許。' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST', 'OPTIONS']);
  try {
    if (!await consume('issue:' + origin, 60)) return json(res, 429, { error:'TTS token 申請太頻繁。' });
    return json(res, 200, { token:issueToken(origin, 60), expiresIn:60 });
  } catch (error) {
    console.warn('[tts token]', error && error.message || error);
    return json(res, error.status || 503, { error:error.status === 403 ? error.message : 'TTS 暫時無法使用。' });
  }
};
