'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const cheerio = require('cheerio');

function blockedIpv4(address) {
  const p = address.split('.').map(Number);
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && (p[1] === 168 || p[1] === 0))
    || (p[0] === 198 && (p[1] === 18 || p[1] === 19 || p[1] === 51))
    || (p[0] === 203 && p[1] === 0 && p[2] === 113);
}

function blockedAddress(address) {
  const kind = net.isIP(address);
  if (kind === 4) return blockedIpv4(address);
  if (kind !== 6) return true;
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return blockedIpv4(lower.slice(7));
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd')
    || /^fe[89ab]/.test(lower) || lower.startsWith('ff') || lower.startsWith('2001:db8:');
}

function parseUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch (error) { throw Object.assign(new Error('網址格式無效。'), { status:400 }); }
  if (url.protocol !== 'https:') throw Object.assign(new Error('只允許匯入 HTTPS 網址。'), { status:400 });
  if (url.username || url.password || (url.port && url.port !== '443')) throw Object.assign(new Error('網址不可包含帳密或非標準連接埠。'), { status:400 });
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw Object.assign(new Error('不允許內部網址。'), { status:400 });
  return url;
}

async function resolvePublicAddress(host) {
  let addresses;
  try { addresses = await dns.lookup(host, { all:true, verbatim:true }); }
  catch (error) { throw Object.assign(new Error('找不到這個網址。'), { status:400 }); }
  if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address))) throw Object.assign(new Error('不允許連線到私人或保留網路位址。'), { status:400 });
  return addresses[0];
}

async function validateUrl(raw) {
  const url = parseUrl(raw);
  await resolvePublicAddress(url.hostname);
  return url;
}

function headerValue(headers, name) {
  const value = headers && headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readLimitedNodeBody(response, limit) {
  const declared = Number(headerValue(response.headers, 'content-length') || 0);
  if (declared > limit) throw Object.assign(new Error('來源內容超過大小限制。'), { status:413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > limit) {
      response.destroy();
      throw Object.assign(new Error('來源內容超過大小限制。'), { status:413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function requestAtValidatedAddress(url) {
  // Resolve once, then dial that exact address. Passing the hostname to global
  // fetch would perform a second DNS lookup after validation and re-open the
  // DNS rebinding window.
  const resolved = await resolvePublicAddress(url.hostname);
  return new Promise((resolve, reject) => {
    const address = resolved.address;
    const family = resolved.family || net.isIP(address);
    const request = https.request({
      protocol:'https:',
      hostname:address,
      port:443,
      method:'GET',
      path:url.pathname + url.search,
      servername:url.hostname,
      headers:{
        Host:url.host,
        'User-Agent':'AI-Avatar-Knowledge-Importer/1.0',
        Accept:'text/html,text/plain;q=0.9',
      },
      lookup:(_hostname, _options, callback) => callback(null, address, family),
    }, (response) => resolve(response));
    request.setTimeout(12000, () => request.destroy(new Error('source request timeout')));
    request.once('error', reject);
    request.end();
  });
}

function htmlToText(html, finalUrl) {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,svg,canvas,form,iframe').remove();
  const title = String($('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text() || finalUrl.hostname).trim().slice(0, 160);
  const content = $('main,article,[role="main"]').first().length ? $('main,article,[role="main"]').first() : $('body');
  content.find('br,h1,h2,h3,h4,h5,h6,p,li,blockquote,section,tr').each(function () { $(this).append('\n'); });
  const text = content.text().replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text:text.slice(0, 500000) };
}

async function fetchSource(rawUrl) {
  let url = parseUrl(rawUrl);
  for (let redirect = 0; redirect <= 3; redirect++) {
    let response;
    try {
      response = await requestAtValidatedAddress(url);
    } catch (error) {
      throw Object.assign(new Error(/timeout/i.test(String(error && error.message)) ? '來源網站連線逾時。' : '無法讀取來源網站。'), { status:502 });
    }
    const location = headerValue(response.headers, 'location');
    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.resume();
      if (redirect === 3) throw Object.assign(new Error('來源網站重新導向次數過多。'), { status:400 });
      url = parseUrl(new URL(location, url).href);
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) throw Object.assign(new Error('來源網站回應 HTTP ' + response.statusCode + '。'), { status:502 });
    const type = String(headerValue(response.headers, 'content-type') || '').toLowerCase();
    if (!type.includes('text/html') && !type.includes('text/plain') && !type.includes('application/xhtml+xml')) throw Object.assign(new Error('網址內容不是支援的網頁或純文字。'), { status:415 });
    let raw;
    let bodyTimer;
    try {
      const timeout = new Promise((resolve, reject) => {
        bodyTimer = setTimeout(() => reject(Object.assign(new Error('body timeout'), { code:'BODY_TIMEOUT' })), 12000);
      });
      raw = await Promise.race([
        readLimitedNodeBody(response, 2 * 1024 * 1024),
        timeout,
      ]);
    } catch (error) {
      if (error && (error.code === 'BODY_TIMEOUT' || error.name === 'AbortError')) {
        response.destroy();
        throw Object.assign(new Error('讀取網頁內容逾時。'), { status:502 });
      }
      throw error;
    } finally {
      clearTimeout(bodyTimer);
    }
    const parsed = type.includes('html') || type.includes('xhtml') ? htmlToText(raw, url) : { title:url.hostname, text:raw.slice(0, 500000) };
    if (parsed.text.length < 40) throw Object.assign(new Error('來源網站沒有足夠的可讀文字。'), { status:422 });
    return { url:url.href, title:parsed.title, text:parsed.text };
  }
  throw Object.assign(new Error('無法讀取來源網站。'), { status:502 });
}

module.exports = { blockedAddress, validateUrl, resolvePublicAddress, requestAtValidatedAddress, htmlToText, fetchSource };
