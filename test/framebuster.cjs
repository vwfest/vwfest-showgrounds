// GitHub Pages frame-buster (docs/frame-guard.js, loaded first by docs/index.html with <html style="display:none">): in a real browser, the page is revealed
// when it is the top window and replaced by a notice (no game, no wallet UI, no scripts) when another site frames it.
const assert = require('assert'); const http = require('http'); const fs = require('fs'); const path = require('path'); const { chromium } = require('playwright');
const DOCS = path.join(__dirname, '..', 'docs'); const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const serve = (handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
(async () => {
  // a stub game page = the REAL index.html, but its heavy bundle requests are answered with a marker script so we can see whether the game would have started
  const game = await serve((rq, rs) => { const u = rq.url.split('?')[0]; if (u === '/js/main.js') { rs.setHeader('content-type', 'text/javascript'); return rs.end('window.__gameStarted = true;'); } if (u === '/config.js') { rs.setHeader('content-type', 'text/javascript'); return rs.end('window.__cfg = 1;'); }
    const f = path.join(DOCS, u === '/' ? 'index.html' : u); if (!f.startsWith(DOCS) || !fs.existsSync(f)) { rs.statusCode = 404; return rs.end(); } rs.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); rs.end(fs.readFileSync(f)); });
  const gurl = 'http://127.0.0.1:' + game.address().port + '/';
  const evil = await serve((rq, rs) => { rs.setHeader('content-type', 'text/html'); rs.end(`<!doctype html><title>evil</title><iframe id="f" src="${gurl}" style="width:800px;height:600px"></iframe>`); });
  const eurl = 'http://localhost:' + evil.address().port + '/';
  const browser = await chromium.launch(); let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
  try {
    await t('top-level: the page is revealed and the game script runs', async () => { const pg = await browser.newPage(); await pg.goto(gurl); await pg.waitForFunction(() => window.__gameStarted === true, null, { timeout: 5000 }); assert.strictEqual(await pg.evaluate(() => getComputedStyle(document.documentElement).display), 'block'); assert(await pg.evaluate(() => !!document.getElementById('join')), 'game DOM present'); await pg.close(); });
    await t('framed by another site: the game never starts, nothing of the wallet/pay UI exists, only a notice with an open-in-new-tab link', async () => {
      const pg = await browser.newPage(); await pg.goto(eurl); const fr = await (await pg.waitForSelector('#f')).contentFrame(); await fr.waitForSelector('a[target=_blank]', { timeout: 5000 });
      assert.strictEqual(await fr.evaluate(() => window.__gameStarted), undefined, 'game script did not run'); assert.strictEqual(await fr.evaluate(() => !!document.getElementById('join') || !!document.getElementById('modals') || !!document.getElementById('c')), false, 'no game DOM');
      assert.match(await fr.evaluate(() => document.body.innerText), /does not run inside another website/); assert.strictEqual(await fr.evaluate(() => document.querySelector('a').href), gurl); assert.strictEqual(await fr.evaluate(() => document.querySelectorAll('script').length), 0, 'no scripts left'); await pg.close(); });
    await t('index.html: the guard is the FIRST script in <head> and the document starts hidden', () => { const h = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8'); assert(/<html[^>]*style="display:none"/.test(h)); const first = h.indexOf('<script'); assert(first > 0 && h.slice(first).startsWith('<script src="frame-guard.js"></script>'), 'guard first'); assert(first < h.indexOf('</head>')); assert(h.indexOf('frame-guard.js') < h.indexOf('js/main.js')); });
  } finally { await browser.close(); game.close(); evil.close(); }
  console.log(process.exitCode ? 'FRAMEBUSTER TESTS FAILED' : `all ${n} frame-buster tests passed`); process.exit(process.exitCode || 0);
})();
