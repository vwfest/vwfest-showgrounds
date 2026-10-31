// Real client IP behind Render (Cloudflare -> Render load balancer -> app).
// X-Forwarded-For's FIRST entry is client-controlled (spoofable) and its LAST entry is the Cloudflare edge, so neither is safe for
// rate limits. Cloudflare overwrites CF-Connecting-IP with the connecting client's address, so prefer that; otherwise use the
// entry just before the edge (the address Cloudflare itself saw). Outside Render (local dev/tests) use the socket address.
'use strict';
const net = require('net');
// Cloudflare's published edge ranges (https://www.cloudflare.com/ips-v4 and /ips-v6, checked 2026-10-31). CF-Connecting-IP is only believed when the connection really came through one of them.
const CF_RANGES = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22", "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];
const toBig = (ip) => { if (net.isIPv4(ip)) return [4, ip.split('.').reduce((a, o) => (a << 8n) + BigInt(o), 0n)];
  if (net.isIPv6(ip)) { let h = ip.toLowerCase().split('%')[0]; const m4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(h); if (m4) { const q = m4[1].split('.').map(Number); h = h.replace(m4[1], ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16)); }
    const [a, b] = h.split('::'); const A = a ? a.split(':') : [], B = b !== undefined && b ? b.split(':') : []; const fill = b === undefined ? [] : Array(8 - A.length - B.length).fill('0'); return [6, [...A, ...fill, ...B].reduce((x, g) => (x << 16n) + BigInt(parseInt(g || '0', 16)), 0n)]; }
  return null; };
const CF_NETS = CF_RANGES.map((c) => { const [ip, bits] = c.split('/'); const [fam, n] = toBig(ip); return { fam, n, bits: BigInt(bits), size: fam === 4 ? 32n : 128n }; });
function isCloudflare(ip) { const t = ip && toBig(String(ip).replace(/^::ffff:/i, '')); if (!t) return false; return CF_NETS.some((r) => r.fam === t[0] && (t[1] >> (r.size - r.bits)) === (r.n >> (r.size - r.bits))); }
const BEHIND_PROXY = () => process.env.RENDER === 'true' || process.env.TRUST_CF === '1';
function clientIp(req) {
  const sock = (req.socket && req.socket.remoteAddress) || '0.0.0.0';
  if (!BEHIND_PROXY()) return req.ip || sock;
  const h = req.headers || {}; const x = String(h['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const edge = x.length && net.isIP(x[x.length - 1]) ? x[x.length - 1] : null; // the address Render's load balancer saw: the one entry no client can forge
  if (edge && isCloudflare(edge)) { // came through Cloudflare: its header / the entry before the edge is the real client
    const cf = typeof h['cf-connecting-ip'] === 'string' ? h['cf-connecting-ip'].trim() : '';
    if (cf && net.isIP(cf)) return cf;
    if (x.length >= 2 && net.isIP(x[x.length - 2])) return x[x.length - 2];
    return edge;
  }
  return edge || sock; // NOT from Cloudflare (direct hit on the origin): CF-Connecting-IP / earlier XFF entries are client-controlled, so ignore them
}
// Express middleware: make req.ip the real client address everywhere (rate limiters, hashes, logs).
function useClientIp(app) {
  app.use((req, res, next) => { const ip = clientIp(req); Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true, writable: true }); next(); });
}
module.exports = { clientIp, useClientIp, isCloudflare };
