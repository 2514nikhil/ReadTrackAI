/**
 * Formats a duration in seconds as "Xh Ym Zs".
 * Zero-value parts are omitted, e.g. "5m 3s" or "2h 10m".
 * Returns "0s" when seconds === 0.
 */
export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);

  return parts.length > 0 ? parts.join(" ") : "0s";
}
