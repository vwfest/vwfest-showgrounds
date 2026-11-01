// Join handshake that never hangs. The join message is KEPT until the server answers (welcome / joinerr / full), so it survives the socket
// closing under it (the server drops idle pre-join sockets after 20 s; on a slow device the page can be busy that long) and is re-sent on
// every new socket. Each send waits `answerMs`; no answer -> the socket is restarted (fresh connection, backoff in Net) and the join re-sent,
// at most `maxTries` times, then the caller shows a clear error with a retry button instead of "Connecting…" forever.
export class JoinFlow {
  constructor(net, { status = () => {}, answerMs = 12000, maxTries = 4, wakeMs = 4000, slowMs = 45000, timers = globalThis } = {}) {
    Object.assign(this, { net, status, answerMs, maxTries, wakeMs, slowMs, T: timers }); this.msg = null; this.tries = 0; this.answerT = 0; this.wakeT = 0; this.retryT = 0;
  }
  get pending() { return this.msg; }
  start(msg, { quiet = false } = {}) { this.clear(); this.msg = msg; this.tries = 0; this.quiet = quiet; this.kick(); }
  kick() { if (!this.msg) return; if (this.net.ready) return this.send(); this.status(this.quiet ? 'reconnecting' : 'reaching'); this.waitOpen(); }
  waitOpen() { this.T.clearTimeout(this.wakeT); this.wakeT = this.T.setTimeout(() => { if (!this.msg || this.net.ready) return; this.status('waking'); this.wakeT = this.T.setTimeout(() => { if (this.msg && !this.net.ready) this.status('unreachable'); }, this.slowMs); }, this.wakeMs); }
  send() {
    if (!this.msg || !this.net.ready) return; this.T.clearTimeout(this.wakeT); this.T.clearTimeout(this.answerT); this.tries++;
    this.net.json(this.msg); this.status(this.tries > 1 ? 'retrying' : 'connecting');
    this.answerT = this.T.setTimeout(() => this.noAnswer(), this.answerMs);
  }
  noAnswer() {
    if (!this.msg) return;
    if (this.tries >= this.maxTries) { const m = this.msg; this.clear(); this.failedMsg = m; this.status('failed'); return; }
    this.status('retrying'); this.net.restart(); // new socket -> onOpen() re-sends
  }
  onOpen() { if (this.msg) this.send(); }
  onClose() { this.T.clearTimeout(this.answerT); if (this.msg) { this.status(this.quiet ? 'reconnecting' : 'reaching'); this.waitOpen(); } }
  retryIn(ms) { if (!this.msg) return; this.T.clearTimeout(this.answerT); this.T.clearTimeout(this.retryT); this.status('cooldown'); this.retryT = this.T.setTimeout(() => this.kick(), ms); }
  retry() { const m = this.msg || this.failedMsg; if (m) this.start(m); }
  done() { this.clear(); this.failedMsg = null; }
  clear() { this.msg = null; for (const k of ['answerT', 'wakeT', 'retryT']) this.T.clearTimeout(this[k]); }
}
