/* =====================================================================
 * api/tts.js — Vercel serverless function
 * 用 msedge-tts 取得微軟「神經語音」(曉臻等) 的 MP3，回傳給前端播放。
 * 免帳號免金鑰。失敗時前端會自動退回瀏覽器內建語音(Yating)。
 *
 * ⚠ 風險與防護（詳見 README）：
 *  - msedge-tts 走的是微軟「非官方」端點，可能違反 ToS、隨時可能失效。
 *  - 請求必須帶有由 /api/tts-token 簽發的短效 token；token 用量由 Neon
 *    原子計數（或本機開發時的 fallback）限制，正式環境另須啟用 Vercel WAF。
 * ===================================================================== */
let _mod;
async function lib() { if (!_mod) _mod = await import('msedge-tts'); return _mod; }

// 允許的聲線白名單（避免被拿去合成任意語言/聲音）
const VOICES = new Set([
  'zh-TW-HsiaoChenNeural', 'zh-TW-HsiaoYuNeural', 'zh-TW-YunJheNeural',
  'zh-CN-XiaoxiaoNeural', 'en-US-AriaNeural', 'en-US-JennyNeural',
  'ja-JP-NanamiNeural',
]);

const { allowedOrigin, bearer, requestOrigin, verifyToken } = require('../lib/tts-security');
const { consume } = require('../lib/tts-rate-limit');

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    if (Buffer.byteLength(raw) > 4096) throw new Error('body too large');
    return JSON.parse(raw || '{}');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

module.exports = async (req, res) => {
  const origin = requestOrigin(req);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    if (!allowedOrigin(origin)) { res.statusCode = 403; res.end('forbidden: bad origin'); return; }
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST, OPTIONS'); res.end('method not allowed'); return; }
    const claims = verifyToken(bearer(req), origin);
    if (!claims) { res.statusCode = 401; res.end('unauthorized'); return; }
    if (!await consume('token:' + claims.jti, 20)) { res.statusCode = 429; res.setHeader('Retry-After', '60'); res.end('rate limited'); return; }

    const body = await readJsonBody(req);
    const text = String(body.text || '').slice(0, 600).trim();
    let voice = String(body.voice || 'zh-TW-HsiaoChenNeural');
    if (!VOICES.has(voice)) voice = 'zh-TW-HsiaoChenNeural';
    if (!text) { res.statusCode = 400; res.end('missing text'); return; }

    const { MsEdgeTTS, OUTPUT_FORMAT } = await lib();
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(escapeXml(text)); // escape 防 SSML 注入

    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      const timer = setTimeout(() => { try { audioStream.destroy && audioStream.destroy(); } catch (e) {} reject(new Error('tts timeout')); }, 20000);
      audioStream.on('data', (c) => chunks.push(c));
      audioStream.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      audioStream.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, no-store'); // 對話文字不進共享快取或 CDN 日誌 key
    res.end(buf);
  } catch (e) {
    console.error('[tts]', e && e.message || e);
    res.statusCode = e && e.status === 413 ? 413 : (e && e.status === 503 ? 503 : 502);
    res.end('tts error');
  }
};
