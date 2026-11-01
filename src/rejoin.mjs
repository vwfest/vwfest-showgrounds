// Auto-retry after the server's join cooldown ("Reconnecting too fast"): the server tells us how long is left (`wait` ms); we try again a moment after that, at most `max` times, and the caller shows a calm
// "Reconnecting…" instead of an error. Returns the delay in ms, or null when this message is not a retryable cooldown / the attempts are used up.
export function rejoinDelay(m, tries, { max = 4, floorMs = 1500, capMs = 15000 } = {}) {
  if (!m || m.err !== 'rate' || !(m.wait > 0) || tries >= max) return null;
  return Math.min(capMs, Math.max(floorMs, Math.ceil(m.wait) + 250 + tries * 500));
}
