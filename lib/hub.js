// The grounds: players, spatial grid (interest management), movement validation, chat. Pure logic + ws sending; no HTTP.
const { cleanChat } = require('./names');
const { cleanAvatar } = require('./avatar');

const S = 200;                           // fixed-point scale for positions (int16)
const HALF = 128;                        // world is [-HALF, HALF] on x and z
const CELL = 32, VIS = 72, NEAR_CHAT = 30, MAX_VIS = 60;
const FL = { MOVING: 1, AIR: 2, DRIVING: 4, EMOTE_SHIFT: 3, EMOTE_MASK: 7 << 3, SIT: 64, SPEAK: 128 };
const i16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v * S)));
const cellOf = (x, z) => Math.floor((x + HALF) / CELL) + 1000 * Math.floor((z + HALF) / CELL);

class Hub {
  constructor(cfg) {
    this.cfg = cfg; this.players = new Map(); this.keys = new Map(); this.grid = new Map(); this.nextId = 1;
    this.chatLog = []; this.tick = 0; this.stats = { tx: 0, rx: 0, snaps: 0, tickMsSum: 0, ticks: 0, joined: 0, rejectedMoves: 0, kicks: 0 };
    this.spawns = [[0, 40], [-10, 42], [10, 42], [-20, 38], [20, 38]];
    this.timer = setInterval(() => this.step(), 100); this.timer.unref();
  }
  get size() { return this.players.size; }
  send(c, data) { if (c && c.ws.readyState === 1) { this.stats.tx += typeof data === 'string' ? Buffer.byteLength(data) : data.length; c.ws.send(data); } }
  json(c, o) { this.send(c, JSON.stringify(o)); }
  all(o) { const s = JSON.stringify(o); for (const p of this.players.values()) this.send(p.conn, s); }
  allocId() { for (let i = 0; i < 65535; i++) { const id = this.nextId; this.nextId = this.nextId % 65535 + 1; if (!this.players.has(id)) return id; } return 0; }
  // ---- join / leave ----
  info(q) { return { id: q.id, nick: q.nick, av: q.av, m: q.minted ? 1 : 0, eq: q.prof.equipped || {}, rd: q.rd || null, pk: q.park || null, nf: q.nft ? { a: q.nft.asset, n: q.nft.name } : undefined }; }
  find(pid) { for (const p of this.players.values()) if (p.prof.id === pid) return p; return null; }
  join(conn, prof, minted) {
    if (conn.player) return { err: 'already' };
    const old = this.find(prof.id); if (old) { this.json(old.conn, { t: 'kick', why: 'Signed in from another tab or device' }); old.conn.ws.close(1000, 'replaced'); this.leave(old); }
    if (this.players.size >= this.cfg.maxPlayers) return { full: true };
    const id = this.allocId(); if (!id) return { full: true };
    const sp = this.spawns[id % this.spawns.length];
    const p = { id, prof, nick: prof.nick, key: prof.key, av: prof.av, x: sp[0] + (Math.random() - 0.5) * 3, y: 0, z: sp[1] + (Math.random() - 0.5) * 3, yaw: Math.PI, flags: 0, ver: 1, lastMove: Date.now(), conn, seen: new Map(), cell: 0, strikes: [], chat: { tokens: 3, last: Date.now(), lastText: '', lastAt: 0, blocked: 0, mutedUntil: 0, lastGlobal: 0 }, minted: !!minted, nonce: null, lastActive: Date.now() };
    p.cell = cellOf(p.x, p.z); this.cellAdd(p);
    this.players.set(id, p); this.keys.set(p.key, id); conn.player = p; this.stats.joined++;
    return { ok: true, p };
  }
  welcome(p, extra) {
    const roster = [...this.players.values()].filter((q) => q !== p).map((q) => this.info(q));
    this.json(p.conn, { t: 'welcome', id: p.id, pid: p.prof.id, nick: p.nick, av: p.av, eq: p.prof.equipped, x: p.x, y: p.y, z: p.z, yaw: p.yaw, roster, chat: this.chatLog.slice(-30), online: this.players.size, cap: this.cfg.maxPlayers, ...extra });
    const s = JSON.stringify({ t: 'p+', ...this.info(p) });
    for (const q of this.players.values()) if (q !== p) this.send(q.conn, s);
    this.sys(`${p.nick} arrived at the grounds`, 'join');
  }
  leave(p) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id); this.keys.delete(p.key); this.cellDel(p); p.conn.player = null;
    this.all({ t: 'p-', id: p.id });
    this.sys(`${p.nick} left`, 'leave');
  }
  sys(text, kind) { this.all({ t: 'sys', text, kind, online: this.players.size }); }
  cellAdd(p) { let s = this.grid.get(p.cell); if (!s) this.grid.set(p.cell, (s = new Set())); s.add(p); }
  cellDel(p) { const s = this.grid.get(p.cell); if (s) { s.delete(p); if (!s.size) this.grid.delete(p.cell); } }
  // ---- movement (binary: [1][x i16][y i16][z i16][yaw u8][flags u8]) ----
  onMove(p, buf) {
    if (buf.length !== 9 || buf[0] !== 1) return;
    const now = Date.now(); p.lastActive = now;
    const x = buf.readInt16LE(1) / S, y = buf.readInt16LE(3) / S, z = buf.readInt16LE(5) / S, yaw = (buf[7] / 256) * Math.PI * 2 - Math.PI;
    let flags = buf[8];
    if (((flags & FL.EMOTE_MASK) >> FL.EMOTE_SHIFT) > 5) flags &= ~FL.EMOTE_MASK;
    if (flags & FL.DRIVING) p.park = null;
    const dt = Math.min(Math.max((now - p.lastMove) / 1000, 0.02), 5);
    const driving = !!(flags & FL.DRIVING);
    const maxV = driving ? this.cfg.carSpeed : this.cfg.walkSpeed;
    const d = Math.hypot(x - p.x, z - p.z);
    const bad = Math.abs(x) > HALF || Math.abs(z) > HALF || y < -0.5 || y > 8 || d > maxV * dt * 1.6 + 1.2 || Math.abs(y - p.y) > 16 * dt + 1.5;
    if (bad) {
      this.stats.rejectedMoves++; p.strikes = p.strikes.filter((t) => now - t < 10000); p.strikes.push(now);
      this.json(p.conn, { t: 'corr', x: p.x, y: p.y, z: p.z });
      if (p.strikes.length > 12) { this.stats.kicks++; this.json(p.conn, { t: 'kick', why: 'Movement out of sync' }); p.conn.ws.close(1008, 'speed'); }
      p.lastMove = now; return;
    }
    p.lastMove = now;
    const moved = x !== p.x || y !== p.y || z !== p.z || yaw !== p.yaw || flags !== p.flags;
    if (!moved) return;
    p.x = x; p.y = y; p.z = z; p.yaw = yaw; p.flags = flags; p.ver = (p.ver + 1) & 0xffff;
    const c = cellOf(x, z); if (c !== p.cell) { this.cellDel(p); p.cell = c; this.cellAdd(p); }
  }
  encode(q, buf, o) { buf.writeUInt16LE(q.id, o); buf.writeInt16LE(i16(q.x), o + 2); buf.writeInt16LE(i16(q.y), o + 4); buf.writeInt16LE(i16(q.z), o + 6); buf[o + 8] = Math.round(((q.yaw + Math.PI) / (Math.PI * 2)) * 256) & 255; buf[o + 9] = q.flags; }
  // ---- 10 Hz interest-managed snapshots: deltas for what changed, a keyframe each second so out-of-range players vanish ----
  step() {
    const t0 = process.hrtime.bigint(); this.tick++;
    const key = this.tick % 10 === 0, now = Date.now();
    const R = Math.ceil(VIS / CELL);
    for (const p of this.players.values()) {
      if (!p.conn || p.conn.ws.readyState !== 1) continue;
      const cx = Math.floor((p.x + HALF) / CELL), cz = Math.floor((p.z + HALF) / CELL);
      let vis = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const s = this.grid.get(cx + dx + 1000 * (cz + dz)); if (!s) continue;
        for (const q of s) if (q !== p) { const d2 = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d2 <= VIS * VIS) vis.push([d2, q]); }
      }
      if (vis.length > MAX_VIS) { vis.sort((a, b) => a[0] - b[0]); vis.length = MAX_VIS; }
      const ids = new Set(), list = [];
      for (const [, q] of vis) { ids.add(q.id); if (key || p.seen.get(q.id) !== q.ver) { list.push(q); p.seen.set(q.id, q.ver); } }
      for (const id of p.seen.keys()) if (!ids.has(id)) p.seen.delete(id);
      if (!list.length && !key) continue;
      const buf = Buffer.allocUnsafe(3 + list.length * 10); buf[0] = key ? 3 : 2; buf.writeUInt16LE(list.length, 1);
      list.forEach((q, i) => this.encode(q, buf, 3 + i * 10));
      this.send(p.conn, buf); this.stats.snaps++;
    }
    if (key) for (const p of this.players.values()) if (now - p.lastActive > this.cfg.idleMs) { this.json(p.conn, { t: 'kick', why: 'Removed for being idle' }); p.conn.ws.close(1000, 'idle'); }
    this.stats.tickMsSum += Number(process.hrtime.bigint() - t0) / 1e6; this.stats.ticks++;
  }
  // ---- chat ----
  onChat(p, msg) {
    const now = Date.now(), c = p.chat; p.lastActive = now;
    if (now < c.mutedUntil) return this.json(p.conn, { t: 'chaterr', why: 'You are muted for a minute: slow down.' });
    c.tokens = Math.min(3, c.tokens + (now - c.last) / 1500); c.last = now;
    if (c.tokens < 1) return this.json(p.conn, { t: 'chaterr', why: 'Slow down a little.' });
    const scope = msg.scope === 'all' ? 'all' : 'near';
    const r = cleanChat(msg.text);
    if (!r.ok) { if (r.why !== 'empty' && ++c.blocked >= 5) { c.mutedUntil = now + 60000; c.blocked = 0; } return this.json(p.conn, { t: 'chaterr', why: r.why === 'empty' || r.why === 'bad' ? 'Nothing to send.' : r.why }); }
    if (r.text.toLowerCase() === c.lastText && now - c.lastAt < 10000) return this.json(p.conn, { t: 'chaterr', why: 'No repeats please.' });
    if (scope === 'all' && now - c.lastGlobal < this.cfg.globalCooldownMs) return this.json(p.conn, { t: 'chaterr', why: 'Global chat: one message every few seconds.' });
    c.tokens -= 1; c.lastText = r.text.toLowerCase(); c.lastAt = now; if (scope === 'all') c.lastGlobal = now;
    const out = { t: 'chat', id: p.id, nick: p.nick, scope, text: r.text, m: p.minted ? 1 : 0, ts: now };
    if (scope === 'all') { this.chatLog.push(out); if (this.chatLog.length > 60) this.chatLog.shift(); this.all(out); return; }
    const s = JSON.stringify(out);
    for (const q of this.players.values()) if (q === p || (q.x - p.x) ** 2 + (q.z - p.z) ** 2 <= NEAR_CHAT * NEAR_CHAT) this.send(q.conn, s);
  }
  onEmote(p, id) {
    // Emotes ride on the movement flags; this just gives a chat-bubble style one-shot to nearby players.
    if (!Number.isInteger(id) || id < 1 || id > 5) return;
    const now = Date.now(); if (now - (p.lastEmote || 0) < 700) return; p.lastEmote = now; p.lastActive = now;
    const s = JSON.stringify({ t: 'emote', id: p.id, e: id });
    for (const q of this.players.values()) if (q === p || (q.x - p.x) ** 2 + (q.z - p.z) ** 2 <= VIS * VIS) this.send(q.conn, s);
  }
  refresh(p) { this.all({ t: 'p+', ...this.info(p) }); }
  setMinted(p) { p.minted = true; this.refresh(p); }
  setAvatar(p, av) { p.av = cleanAvatar(av); p.ver = (p.ver + 1) & 0xffff; this.refresh(p); }
}
module.exports = { Hub, FL, S, HALF };
