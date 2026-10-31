// WebSocket client: JSON control messages + 9-byte binary movement up / compact binary snapshots down.
export class Net {
  constructor(url) { this.url = url; this.ws = null; this.on = {}; this.open = false; this.tries = 0; this.closedByUs = false; this.sent = 0; this.recv = 0; }
  connect() {
    this.closedByUs = false; const ws = new WebSocket(this.url); ws.binaryType = 'arraybuffer'; this.ws = ws;
    ws.onopen = () => { this.open = true; this.tries = 0; this.emit('open'); };
    ws.onmessage = (e) => { this.recv += e.data.byteLength || e.data.length; if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch { return; } this.emit(m.t, m); } else this.emit('bin', new DataView(e.data)); };
    ws.onclose = (e) => { const was = this.open; this.open = false; this.emit('close', { code: e.code, was }); if (!this.closedByUs && !this.noReconnect) setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.tries++)); };
    ws.onerror = () => {};
  }
  emit(t, m) { const f = this.on[t]; if (f) f(m); }
  json(o) { if (this.open) { const s = JSON.stringify(o); this.sent += s.length; this.ws.send(s); } }
  move(x, y, z, yaw, flags) { // [1][x i16][y i16][z i16][yaw u8][flags u8], fixed point /200
    if (!this.open || this.ws.bufferedAmount > 4096) return; const b = new DataView(new ArrayBuffer(9)); const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 200)));
    b.setUint8(0, 1); b.setInt16(1, q(x), true); b.setInt16(3, q(y), true); b.setInt16(5, q(z), true); b.setUint8(7, Math.round(((yaw + Math.PI) / (Math.PI * 2)) * 256) & 255); b.setUint8(8, flags & 255); this.ws.send(b.buffer); this.sent += 9;
  }
  close() { this.closedByUs = true; try { this.ws.close(); } catch {} }
}
export function decodeSnapshot(dv) { // returns {key, list:[{id,x,y,z,yaw,flags}]}
  const type = dv.getUint8(0), n = dv.getUint16(1, true), list = [];
  for (let i = 0, o = 3; i < n; i++, o += 10) list.push({ id: dv.getUint16(o, true), x: dv.getInt16(o + 2, true) / 200, y: dv.getInt16(o + 4, true) / 200, z: dv.getInt16(o + 6, true) / 200, yaw: (dv.getUint8(o + 8) / 256) * Math.PI * 2 - Math.PI, flags: dv.getUint8(o + 9) });
  return { key: type === 3, list };
}
