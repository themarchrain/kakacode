export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 999_500) {
    return `${Math.round(value / 1_000)}k`;
  }
  // Ten million and up loses the decimal: a row of narrow cells cannot spare it.
  const millions = value / 1_000_000;
  return millions >= 10
    ? `${Math.round(millions)}m`
    : `${millions.toFixed(1).replace(/\.0$/, "")}m`;
}
