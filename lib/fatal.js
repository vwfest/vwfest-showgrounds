// Process-level safety net. An unhandled rejection is logged and the server keeps serving. An uncaught exception leaves the process in an unknown state, so it exits (the platform restarts a clean one) --
// but RELIABLY: the report is written with a synchronous write (a piped stdout/stderr can drop async console output on exit), the listener stops taking new connections, ledger writes that are already in flight
// (burn records, used signatures) get a bounded chance to land, and the exit is forced after `timeoutMs` no matter what. Re-entrant: a second error while exiting does nothing.
'use strict';
const fs = require('fs');
function install({ proc = process, log = (s) => { try { fs.writeSync(2, s + '\n'); } catch { /* stderr closed */ } }, flush = async () => {}, stop = () => {}, timeoutMs = 4000, exit = (c) => proc.exit(c) } = {}) {
  let dying = false;
  const text = (e) => String((e && e.stack) || e).slice(0, 4000);
  proc.on('unhandledRejection', (e) => log('[process] unhandledRejection (still serving): ' + text(e)));
  proc.on('uncaughtException', (e) => {
    if (dying) return; dying = true; log('[process] uncaughtException, exiting so the platform restarts a clean process: ' + text(e)); proc.exitCode = 1;
    try { stop(); } catch { /* already closed */ }
    const timer = setTimeout(() => exit(1), timeoutMs); // forced exit: a hung flush must not keep a broken process alive
    Promise.resolve().then(flush).catch((x) => log('[process] flush failed: ' + text(x))).then(() => { clearTimeout(timer); exit(1); });
  });
  return { get dying() { return dying; } };
}
module.exports = { install };
