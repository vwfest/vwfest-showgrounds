'use strict';
// DJ booth: one DJ at a time (queue + time slot + admin override). The server is the clock: it publishes {track, startedAt} and every client
// plays the same CC0 playlist file from the matching offset (so everyone hears the same thing). The DJ's microphone is relayed as small
// μ-law audio packets only while they talk. The server never touches audio files; it only needs titles and durations from playlist.json.
const fs = require('fs'); const path = require('path');
const BOOTH = { x: 0, z: -73 };
class DJ {
  constructor({ hub, env = process.env, playlistFile = path.join(__dirname, '..', 'docs', 'assets', 'music', 'playlist.json'), now = () => Date.now() }) {
    this.hub = hub; this.now = now; this.booth = BOOTH;
    this.slotMs = env.DJ_SLOT_MS ? +env.DJ_SLOT_MS : Math.max(0, +(env.DJ_SLOT_MIN || 15)) * 60e3; this.queueMax = Math.max(1, +(env.DJ_QUEUE_MAX || 8));
    this.claimR = 8; this.leaveR = 22; this.graceMs = 30e3; this.farMs = 20e3;
    this.enabled = env.DJ_ENABLED !== '0';
    try { this.playlist = JSON.parse(fs.readFileSync(playlistFile, 'utf8')).tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, file: t.file, dur: t.dur })); } catch { this.playlist = []; }
    this.dj = null; this.queue = []; this.track = null; this.mic = false; this.hypes = 0; this.version = 0; this.lastPush = 0; this.pkts = 0; this.pktT = 0; this.bytes = 0; this.maxBps = Math.max(8000, +(env.DJ_MIC_MAX_BPS || 24000)); this.micRange = Math.max(20, +(env.DJ_MIC_RANGE || 110));
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error('[dj] tick failed:', e && e.stack || e); } }, 1000); this.timer.unref();
  }
  near(p, r) { return Math.hypot(p.x - this.booth.x, p.z - this.booth.z) <= r; }
  inQueue(p) { return this.queue.findIndex((q) => q.pid === p.prof.id); }
  isDj(p) { return !!(this.dj && this.dj.pid === p.prof.id); }
  // ---- state sent to clients ----
  view() {
    const t = this.track; const tr = t && this.playlist[t.idx];
    return { t: 'dj', on: this.enabled && this.playlist.length > 0, now: this.now(), dj: this.dj ? { id: this.dj.id, nick: this.dj.nick, until: this.dj.until, since: this.dj.since } : null,
      queue: this.queue.slice(0, 8).map((q) => ({ id: q.id, nick: q.nick })), qn: this.queue.length, slotMs: this.slotMs,
      track: tr ? { i: t.idx, title: tr.title, artist: tr.artist, file: tr.file, dur: tr.dur, at: t.startedAt } : null, mic: this.mic, ver: this.version };
  }
  push() { this.version++; this.hub.all(this.view()); }
  hello(p) { this.hub.json(p.conn, this.view()); }
  // ---- claiming ----
  claim(p) {
    if (!this.enabled || !this.playlist.length) return { ok: false, why: 'The DJ booth is closed right now.' };
    if (this.isDj(p)) return { ok: true, you: 'dj' };
    const qi = this.inQueue(p); if (qi >= 0) return { ok: true, you: 'queued', pos: qi + 1 };
    if (!this.dj && !this.queue.length) { if (!this.near(p, this.claimR)) return { ok: false, why: 'Walk up to the DJ booth in front of the stage first.' }; this.start(p, false); this.push(); return { ok: true, you: 'dj' }; }
    if (this.queue.length >= this.queueMax) return { ok: false, why: 'The DJ queue is full. Try again in a bit.' };
    const t = this.now(); if (t - (p.lastQueueJoin || 0) < 1500) return { ok: false, why: 'Slow down a little.' }; p.lastQueueJoin = t; // every join/leave rebroadcasts the state to the whole crowd
    this.queue.push({ id: p.id, pid: p.prof.id, nick: p.nick }); this.push(); return { ok: true, you: 'queued', pos: this.queue.length };
  }
  start(p, promoted) {
    const t = this.now(); this.dj = { id: p.id, pid: p.prof.id, nick: p.nick, since: t, until: this.slotMs ? t + this.slotMs + (promoted ? this.graceMs : 0) : 0, promoted, away: 0, arrived: !promoted };
    this.mic = false; if (!this.track) this.track = { idx: 0, startedAt: t };
    this.hub.json(p.conn, { t: 'toast', text: promoted ? `🎧 It is your turn on the decks! Walk to the booth within ${Math.round(this.graceMs / 1000)} seconds.` : '🎧 You are the DJ! Pick tracks, skip, and hold T to talk over the music.' });
    this.hub.sys(`🎧 ${p.nick} is now the DJ`, 'dj');
  }
  release(why) {
    const old = this.dj; this.dj = null; this.mic = false;
    if (old && why) { const p = this.hub.find(old.pid); if (p && p.conn) this.hub.json(p.conn, { t: 'toast', text: why }); }
    while (this.queue.length) { const q = this.queue.shift(); const p = this.hub.find(q.pid); if (p) { this.start(p, true); return this.push(); } }
    this.track = null; if (old) this.hub.sys('🎧 The decks are free: walk up to the DJ booth to play', 'dj'); this.push();
  }
  leave(p) { const qi = this.inQueue(p); if (qi >= 0) { this.queue.splice(qi, 1); this.push(); return true; } if (this.isDj(p)) { this.release(); return true; } return false; }
  drop(p) { if (!this.enabled) return; if (this.inQueue(p) >= 0 || this.isDj(p)) this.leave(p); }   // disconnect
  // ---- DJ controls ----
  setTrack(p, idx) { if (!this.isDj(p) || !Number.isInteger(idx) || idx < 0 || idx >= this.playlist.length) return false; this.track = { idx, startedAt: this.now() }; this.push(); return true; }
  skip(p) { if (!this.isDj(p) || !this.playlist.length) return false; this.track = { idx: ((this.track ? this.track.idx : -1) + 1) % this.playlist.length, startedAt: this.now() }; this.push(); return true; }
  setMic(p, on) { if (!this.isDj(p)) return false; on = !!on; if (on !== this.mic) { this.mic = on; this.push(); } return true; }
  hype(p) { const t = this.now(); if (t - (p.lastHype || 0) < 1500) return false; p.lastHype = t; this.hypes++; const m = JSON.stringify({ t: 'djh', id: p.id }); for (const q of this.hub.players.values()) if (Math.hypot(q.x - this.booth.x, q.z - this.booth.z) < 110) this.hub.send(q.conn, m); return true; }
  // ---- admin override ----
  admin(action) {
    if (action === 'release') { if (!this.dj) return { ok: false, why: 'nobody is DJing' }; const n = this.dj.nick; this.release('An admin ended your DJ set.'); return { ok: true, released: n }; }
    if (action === 'clear') { const n = this.queue.length; this.queue = []; this.push(); return { ok: true, cleared: n }; }
    if (action === 'next') { if (!this.playlist.length) return { ok: false }; this.track = { idx: ((this.track ? this.track.idx : -1) + 1) % this.playlist.length, startedAt: this.now() }; this.push(); return { ok: true }; }
    return { ok: false, why: 'unknown action' };
  }
  // ---- DJ mic relay (binary [4][seq][μ-law...]); only the DJ while the mic flag is on; everyone else listens ----
  relay(p, buf) {
    if (!this.isDj(p) || !this.mic || buf.length < 8 || buf.length > 4096) return false; if (this.hub.mod && this.hub.mod.muted(p.prof.id)) return false;
    const t = this.now(); if (t - this.pktT > 1000) { this.pktT = t; this.pkts = 0; this.bytes = 0; } if (++this.pkts > 30 || (this.bytes += buf.length) > this.maxBps) return false; // hard cap: 30 packets and ~24 KB per second (16 kB/s is a real μ-law stream)
    const r2 = this.micRange * this.micRange; // only listeners within earshot of the stage get the audio (the rest is never copied or queued)
    for (const q of this.hub.players.values()) { if (q === p || !q.conn || q.conn.ws.readyState !== 1 || q.conn.ws.bufferedAmount > 65536) continue; if ((q.x - this.booth.x) ** 2 + (q.z - this.booth.z) ** 2 > r2) continue; this.hub.send(q.conn, buf); } return true;
  }
  tick() {
    if (!this.enabled) return; const t = this.now(); let changed = false;
    if (this.dj) {
      const p = this.hub.find(this.dj.pid);
      if (!p) { this.release(); return; }
      if (this.near(p, this.claimR + 4)) { this.dj.arrived = true; this.dj.away = 0; } else { this.dj.away += 1000; }
      if (!this.dj.arrived && t - this.dj.since > this.graceMs) { return this.release('You did not reach the booth in time, so the next DJ is up.'); }
      if (this.dj.arrived && this.dj.promoted && this.slotMs && !this.dj.clock) { this.dj.clock = true; this.dj.until = t + this.slotMs; changed = true; }
      if (this.dj.arrived && this.dj.away > this.farMs && !this.near(p, this.leaveR)) return this.release('You left the booth, so your DJ set ended.');
      if (this.dj.until && t >= this.dj.until) return this.release('Your DJ slot is over. Thanks for playing! 🎧');
    }
    const tr = this.track && this.playlist[this.track.idx];
    if (this.track && tr && t >= this.track.startedAt + tr.dur * 1000) { this.track = { idx: (this.track.idx + 1) % this.playlist.length, startedAt: this.track.startedAt + tr.dur * 1000 }; if (t - this.track.startedAt > 5000) this.track.startedAt = t; changed = true; }
    if (changed || (this.dj && t - this.lastPush > 20000)) { this.lastPush = t; this.push(); }
  }
}
module.exports = { DJ, BOOTH };
