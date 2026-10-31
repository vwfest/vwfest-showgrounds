// Clickjacking mitigation for the GitHub Pages build (Pages cannot send frame-ancestors / X-Frame-Options, and a <meta> CSP ignores frame-ancestors):
// when this page is embedded in another page, wallet / payment screens refuse to run (the game itself may still be viewed).
export const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
export const FRAME_MSG = 'For your safety, wallets and payments do not work inside another website. Open the game directly in its own tab to continue.';
export const openDirect = () => { try { window.open(location.href.split('#')[0], '_blank', 'noopener,noreferrer'); } catch {} };
export function assertTop() { if (framed) throw new Error(FRAME_MSG); }
