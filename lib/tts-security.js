'use strict';

const crypto = require('node:crypto');

function failure(message, status) {
  return Object.assign(new Error(message), { status:status || 503 });
}

function normaliseOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/i.test(url.hostname))) return '';
    return url.origin.toLowerCase();
  } catch (error) {
    return '';
  }
}

function configuredOrigins() {
  const values = [
    ...(process.env.TTS_ALLOWED_ORIGINS || '').split(','),
    ...(process.env.TTS_PUBLIC_ORIGIN || '').split(','),
  ];
  for (const value of (process.env.TTS_ALLOWED_HOSTS || '').split(',')) {
    const host = value.trim();
    if (host) values.push(/^https?:\/\//i.test(host) ? host : 'https://' + host);
  }
  return new Set(values.map(normaliseOrigin).filter(Boolean));
}

function allowedOrigin(value) {
  const origin = normaliseOrigin(value);
  if (!origin) return false;
  if (configuredOrigins().has(origin)) return true;
  return process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function tokenSecret() {
  const secret = String(process.env.TTS_TOKEN_SECRET || '');
  if (secret.length < 32) throw failure('TTS_TOKEN_SECRET 尚未設定或長度不足。');
  return secret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', tokenSecret()).update(value).digest('base64url');
}

function issueToken(origin, ttlSeconds) {
  origin = normaliseOrigin(origin);
  if (!allowedOrigin(origin)) throw failure('TTS 來源未獲允許。', 403);
  const ttl = Math.max(30, Math.min(Number(ttlSeconds) || 60, 120));
  const payload = { typ:'tts', origin, exp:Math.floor(Date.now() / 1000) + ttl, jti:crypto.randomBytes(18).toString('base64url') };
  const encoded = encode(payload);
  return encoded + '.' + sign(encoded);
}

function verifyToken(token, origin) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
    const expected = sign(parts[0]);
    const actual = Buffer.from(parts[1]);
    const expectedBuffer = Buffer.from(expected);
    if (actual.length !== expectedBuffer.length || !crypto.timingSafeEqual(actual, expectedBuffer)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const requestOrigin = normaliseOrigin(origin);
    if (payload.typ !== 'tts' || !payload.jti || !allowedOrigin(payload.origin) || payload.origin !== requestOrigin || !Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function requestOrigin(req) {
  return normaliseOrigin(req && req.headers && req.headers.origin);
}

function bearer(req) {
  const value = String(req && req.headers && req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

module.exports = { normaliseOrigin, configuredOrigins, allowedOrigin, issueToken, verifyToken, requestOrigin, bearer };
