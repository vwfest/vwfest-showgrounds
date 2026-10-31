// Frame-buster for the GitHub Pages build. Pages cannot send frame-ancestors / X-Frame-Options and a <meta> CSP ignores frame-ancestors, so a hostile site could
// frame this page (clickjacking the wallet / pay screens). index.html loads this file FIRST, with <html style="display:none">: the page is only revealed when it is the top window.
// Framed: stop loading, try to navigate the top window to this page, and otherwise replace everything with a notice and a link that opens the game in its own tab.
// Add an origin to ALLOW only for a site you control and trust to embed the game.
(function () {
  var ALLOW = [];
  var root = document.documentElement, topWin = false, parentOk = false;
  try { topWin = window.top === window.self; } catch (e) { topWin = false; }
  try { var ao = window.location.ancestorOrigins; parentOk = !topWin && !!ao && ao.length === 1 && ALLOW.indexOf(ao[0]) !== -1; } catch (e) { parentOk = false; }
  if (topWin || parentOk) { root.style.removeProperty('display'); return; }
  try { window.stop(); } catch (e) {}
  try { window.top.location = window.self.location.href; } catch (e) {} // blocked by the browser unless allowed; harmless when blocked
  while (root.firstChild) root.removeChild(root.firstChild);
  var body = document.createElement('body'); body.style.cssText = 'margin:0;background:#101018;color:#fff;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center';
  var box = document.createElement('div'); box.style.cssText = 'max-width:28em;padding:1.5rem';
  var p = document.createElement('p'); p.textContent = 'For your safety, VW FEST SHOW GROUNDS does not run inside another website. Open it directly in its own tab.';
  var a = document.createElement('a'); a.textContent = 'Open the game'; a.href = window.self.location.href.split('#')[0]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.cssText = 'color:#ffcc33;font-weight:bold';
  box.appendChild(p); box.appendChild(a); body.appendChild(box); root.appendChild(body); root.style.display = 'block';
})();
