// Admin moderation: mute / kick / ban by profile id (pid) for a duration. In memory (a restart clears it; bans also remember the player's IP so a new profile on the same network is refused too).
// Enforced in chat, WebRTC signaling, the DJ mic relay and join.
'use strict';
const MAX_MIN = 525600; // 1 year
class Moderation {
  constructor(now = () => Date.now()) { this.now = now; this.mutes = new Map(); this.bans = new Map(); this.ipBans = new Map(); }
  static minutes(v, dflt) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_MIN) : dflt; }
  sweep() { const t = this.now(); for (const m of [this.mutes, this.bans, this.ipBans]) for (const [k, v] of m) if (v <= t) m.delete(k); }
  mute(pid, minutes) { this.mutes.set(pid, this.now() + minutes * 60000); }
  unmute(pid) { return this.mutes.delete(pid); }
  ban(pid, minutes, ip) { const u = this.now() + minutes * 60000; this.bans.set(pid, u); if (ip) this.ipBans.set(ip, u); }
  unban(pid) { const r = this.bans.delete(pid); return r; }
  unbanIp(ip) { return this.ipBans.delete(ip); }
  muted(pid) { const u = this.mutes.get(pid); if (!u) return false; if (u <= this.now()) { this.mutes.delete(pid); return false; } return true; }
  banned(pid, ip) { const t = this.now(); const u = pid && this.bans.get(pid); if (u) { if (u > t) return true; this.bans.delete(pid); } const v = ip && this.ipBans.get(ip); if (v) { if (v > t) return true; this.ipBans.delete(ip); } return false; }
  list() { this.sweep(); const t = this.now(); const o = (m) => [...m].map(([k, v]) => ({ id: k, minutesLeft: Math.ceil((v - t) / 60000) })); return { mutes: o(this.mutes), bans: o(this.bans), ipBans: this.ipBans.size }; }
}
module.exports = { Moderation, MAX_MIN };
