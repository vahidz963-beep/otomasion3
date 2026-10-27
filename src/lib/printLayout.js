export function calculateSinglePageScale(availableWidth, availableHeight, contentWidth, contentHeight) {
  const aw = Number(availableWidth);
  const ah = Number(availableHeight);
  const cw = Number(contentWidth);
  const ch = Number(contentHeight);
  if (![aw, ah, cw, ch].every(Number.isFinite) || aw <= 0 || ah <= 0 || cw <= 0 || ch <= 0) return 1;
  return Math.min(1, aw / cw, ah / ch);
}
