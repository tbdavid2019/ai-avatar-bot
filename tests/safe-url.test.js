'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const dns = require('node:dns').promises;
const https = require('node:https');

const safeUrl = require('../lib/safe-url');

assert.equal(safeUrl.blockedAddress('10.0.0.1'), true);
assert.equal(safeUrl.blockedAddress('192.0.2.10'), true);
assert.equal(safeUrl.blockedAddress('93.184.216.34'), false);

const originalLookup = dns.lookup;
const originalRequest = https.request;
const originalFetch = global.fetch;
let requestOptions;

dns.lookup = async () => [{ address:'93.184.216.34', family:4 }];
https.request = (options, callback) => {
  requestOptions = options;
  const request = new EventEmitter();
  request.setTimeout = () => {};
  request.destroy = () => {};
  request.end = () => {};
  process.nextTick(() => {
    const response = Readable.from([Buffer.from('A public source with enough readable text.')]);
    response.statusCode = 200;
    response.headers = { 'content-type':'text/plain', 'content-length':'42' };
    callback(response);
  });
  return request;
};
global.fetch = () => { throw new Error('global fetch must not resolve the hostname'); };

(async () => {
  const result = await safeUrl.fetchSource('https://example.com/docs');
  assert.equal(result.url, 'https://example.com/docs');
  assert.equal(requestOptions.hostname, '93.184.216.34');
  assert.equal(requestOptions.servername, 'example.com');
  assert.equal(requestOptions.headers.Host, 'example.com');
  assert.equal(requestOptions.lookup('ignored.example', {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '93.184.216.34');
    assert.equal(family, 4);
  }), undefined);
  console.log('safe-url tests passed');
})()
  .finally(() => {
    dns.lookup = originalLookup;
    https.request = originalRequest;
    global.fetch = originalFetch;
  })
  .catch((error) => { console.error(error); process.exitCode = 1; });
