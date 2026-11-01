// WebSocket client: JSON control messages + 9-byte binary movement up / compact binary snapshots down.
export class Net {
  constructor(url) { this.url = url; this.ws = null; this.on = {}; this.open = false; this.tries = 0; this.closedByUs = false; this.sent = 0; this.recv = 0; }
  connect() {
    this.closedByUs = false; clearTimeout(this.retryT); const ws = new WebSocket(this.url); ws.binaryType = 'arraybuffer'; this.ws = ws;
    // Every handler ignores events from a socket that is no longer the current one (a late close of an old socket must not mark the new one closed).
    ws.onopen = () => { if (this.ws !== ws) return; this.open = true; this.tries = 0; this.emit('open'); };
    ws.onmessage = (e) => { if (this.ws !== ws) return; this.recv += e.data.byteLength || e.data.length; if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch { return; } this.emit(m.t, m); } else this.emit('bin', new DataView(e.data)); };
    ws.onclose = (e) => { if (this.ws !== ws) return; const was = this.open; this.open = false; this.emit('close', { code: e.code, reason: e.reason, was }); if (!this.closedByUs && !this.noReconnect) { const d = Math.min(15000, 1000 * 2 ** this.tries++) * (0.8 + Math.random() * 0.4); this.retryT = setTimeout(() => this.connect(), d); } };
    ws.onerror = () => {};
  }
  // true only while the CURRENT socket can actually send (the server may already be closing it: `open` flips only when onclose runs)
  get ready() { return !!(this.open && this.ws && this.ws.readyState === 1); }
  // Drop the current socket now and reconnect right away (used when a join got no answer): the old socket's events are ignored from here on.
  restart() { const old = this.ws; this.open = false; this.tries = 0; clearTimeout(this.retryT); if (old) { old.onopen = old.onmessage = old.onclose = null; try { old.close(); } catch {} } this.emit('close', { code: 4000, was: false, restart: true }); if (!this.noReconnect) this.connect(); }
  emit(t, m) { if (m && m.iceServers) this.ice = m.iceServers; const f = this.on[t]; if (f) f(m); }
  sendBin(u8) { if (this.ready && this.ws.bufferedAmount < 16384) { this.sent += u8.length; this.ws.send(u8); } }
  json(o) { if (o && o.t === 'join') this.lastJoin = o; if (this.ready) { const s = JSON.stringify(o); this.sent += s.length; this.ws.send(s); } }
  move(x, y, z, yaw, flags) { // [1][x i16][y i16][z i16][yaw u8][flags u8], fixed point /200
    if (!this.ready || this.ws.bufferedAmount > 4096) return; const b = new DataView(new ArrayBuffer(9)); const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 200)));
    b.setUint8(0, 1); b.setInt16(1, q(x), true); b.setInt16(3, q(y), true); b.setInt16(5, q(z), true); b.setUint8(7, Math.round(((yaw + Math.PI) / (Math.PI * 2)) * 256) & 255); b.setUint8(8, flags & 255); this.ws.send(b.buffer); this.sent += 9;
  }
  close() { this.closedByUs = true; clearTimeout(this.retryT); try { this.ws.close(); } catch {} }
}
export function decodeSnapshot(dv) { // returns {key, list:[{id,x,y,z,yaw,flags}]}
  const type = dv.getUint8(0), n = dv.getUint16(1, true), list = [];
  for (let i = 0, o = 3; i < n; i++, o += 10) list.push({ id: dv.getUint16(o, true), x: dv.getInt16(o + 2, true) / 200, y: dv.getInt16(o + 4, true) / 200, z: dv.getInt16(o + 6, true) / 200, yaw: (dv.getUint8(o + 8) / 256) * Math.PI * 2 - Math.PI, flags: dv.getUint8(o + 9) });
  return { key: type === 3, list };
}
