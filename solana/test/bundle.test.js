'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
test('browser client bundles for the web with no Node builtins', (t) => {
  let esbuild; try { esbuild = require('esbuild'); } catch { return t.skip('esbuild not installed'); }
  const r = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../client.js')], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
  const out = r.outputFiles[0].text; assert.ok(out.length > 1000); assert.ok(!/require\("(crypto|fs|path|http|https|net)"\)/.test(out));
  for (const name of ['createClient', 'hasInjected', 'connectInjected', 'balances', 'onrampUrl', 'bridgeLinks']) assert.ok(new RegExp('\\b' + name + '\\b').test(out), name);
});
