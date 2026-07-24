'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type':'text/plain' }); res.end('ok'); return; }
  if (req.url === '/api/admin/config') {
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end(JSON.stringify({ configured:false, message:'登入或資料庫尚未設定。' }));
    return;
  }
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const requested = pathname === '/e2e-widget.html' ? path.join(__dirname, 'e2e/e2e-widget.html') : path.join(root, pathname.replace(/^\//, ''));
  if (!requested.startsWith(root) || !fs.existsSync(requested) || fs.statSync(requested).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const type = requested.endsWith('.html') ? 'text/html; charset=utf-8' : requested.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8';
  res.writeHead(200, { 'Content-Type':type, 'Cache-Control':'no-store' });
  fs.createReadStream(requested).pipe(res);
});

server.listen(4173, '127.0.0.1');
