// Horn and engine must put a real signal on the audio graph after a user gesture, on a desktop and a phone viewport.
// Proximity voice is a different AudioContext and is not started here.
process.env.SERVER_SECRET = 'snd-test-secret-0123456789abcdef'; process.env.PORT = '3421'; process.env.PROFILE_CREATE_PER_HOUR = '1000'; process.env.MAX_CONNS_PER_IP = '200';
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const { launch, until } = require('./lib.cjs'); const { devices } = require('playwright'); const S = require('../server.js');
(async () => {
  const { engineTone, HORN } = await import('../src/ridesnd.mjs');
  const idle = engineTone(true, 0, 0), full = engineTone(true, 1, 0), coast = engineTone(true, 0, 17), both = engineTone(true, 1, 17), off = engineTone(false, 1, 17);
  assert(off.gain === 0, 'engine is silent on foot');
  assert(idle.gain > 0.02 && full.gain > idle.gain && full.freq > idle.freq, 'throttle raises pitch and loudness');
  assert(coast.freq > idle.freq && coast.gain > idle.gain, 'speed raises pitch and loudness');
  assert(HORN.gain > both.gain && HORN.seconds > 0.2, 'horn is louder than a full-rev engine');
  const src = fs.readFileSync(path.join(__dirname, '../src/ridesnd.mjs'), 'utf8');
  assert(!/from ['"]\.\/voice/.test(src), 'ride sound must not import voice');
  console.log('ok   engineTone throttle and speed');

  await S.init(); await new Promise((r) => S.server.listen(3421, '127.0.0.1', r));
  const b = await launch();
  const loud = async (pg, ms = 400) => { let m = 0; const t = Date.now(); while (Date.now() - t < ms) { m = Math.max(m, await pg.evaluate(() => window.__sg.snd.level())); await pg.waitForTimeout(30); } return m; };
  const run = async (label, contextOpts, drive) => {
    const ctx = await b.newContext(contextOpts); const pg = await ctx.newPage(); pg.setDefaultTimeout(30000);
    await pg.goto('http://127.0.0.1:3421/?quality=low'); await until(pg, () => window.__ready, null, 120000);
    const nick = label.slice(0, 2) + Math.floor(Math.random() * 8000 + 1000);
    await pg.fill('input[aria-label=Nickname]', nick);
    await pg.locator('text=Create profile').click(); // real gesture: unlocks the ride AudioContext
    await until(pg, () => window.__sg.state.me && window.__sg.state.me.pid, null, 60000);
    await pg.evaluate(() => document.querySelectorAll('#modals > *').forEach((m) => m.remove()));
    const st = await pg.evaluate(() => window.__sg.snd.live().state);
    assert.strictEqual(st, 'running', label + ' audio context ' + st);
    const quiet = await loud(pg, 200);
    assert(quiet < 0.02, label + ' silent before horn/engine ' + quiet);
    await drive(pg);
    await pg.waitForTimeout(400);
    const idleLv = await loud(pg, 250); const idleLive = await pg.evaluate(() => window.__sg.snd.live());
    assert(idleLv > 0.015, label + ' idle engine output ' + idleLv);
    await pg.keyboard.down('w'); await pg.waitForTimeout(500);
    const gasLv = await loud(pg, 250); const gasLive = await pg.evaluate(() => window.__sg.snd.live());
    await pg.keyboard.up('w');
    assert(gasLive.freq > idleLive.freq + 8, label + ' throttle pitch ' + idleLive.freq + ' -> ' + gasLive.freq);
    assert(gasLive.gain > idleLive.gain + 0.02, label + ' throttle gain ' + idleLive.gain + ' -> ' + gasLive.gain);
    assert(gasLv > idleLv, label + ' throttle output ' + idleLv + ' -> ' + gasLv);
    await pg.waitForTimeout(200);
    const beforeHorn = await loud(pg, 120);
    await pg.evaluate(() => { window.__cap = 0; document.querySelector('#emotes').addEventListener('click', () => { const t0 = performance.now(); const id = setInterval(() => { window.__cap = Math.max(window.__cap, window.__sg.snd.level()); if (performance.now() - t0 > 400) clearInterval(id); }, 16); }); });
    await pg.locator('#emotes .emo', { hasText: 'Honk' }).click();
    await pg.waitForTimeout(500);
    const horn = await pg.evaluate(() => window.__cap);
    assert(horn > beforeHorn && horn > 0.08, label + ' horn over engine ' + beforeHorn + ' -> ' + horn);
    if (label === 'iphone') {
      await pg.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await pg.waitForTimeout(80);
      const hiddenLv = await loud(pg, 180); const hiddenGain = await pg.evaluate(() => window.__sg.snd.master.gain.value);
      assert.strictEqual(hiddenGain, 0, 'hidden tab master gain');
      assert(hiddenLv < 0.02, 'hidden tab still audible ' + hiddenLv);
      await pg.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await pg.waitForTimeout(120);
      const back = await loud(pg, 250); const shownGain = await pg.evaluate(() => window.__sg.snd.master.gain.value);
      assert.strictEqual(shownGain, 1, 'resumed tab master gain');
      assert(back > 0.015, 'engine silent after resume ' + back);
    }
    const voiceOn = await pg.evaluate(() => { const v = window.__sg.voice(); return !!(v && v.on); });
    assert.strictEqual(voiceOn, false, label + ' voice was turned on');
    console.log('ok  ', label, 'horn', horn.toFixed(3), 'idle', idleLv.toFixed(3), idleLive.freq.toFixed(0) + 'Hz', 'gas', gasLv.toFixed(3), gasLive.freq.toFixed(0) + 'Hz');
    await ctx.close();
  };
  try {
    await run('desktop', { viewport: { width: 1280, height: 800 } }, async (pg) => { await pg.keyboard.press('e'); });
    await run('iphone', devices['iPhone 13'], async (pg) => { await pg.locator('#bDrive').tap(); });
  } finally { await b.close(); S.server.close(); }
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
