/**
 * Formats integers/numbers into compact human-readable strings (e.g., 1K, 10K, 999.9K, 1M, 1B, 1T).
 * Never rolls 999.9K into 1000K; strips unnecessary trailing ".0".
 */
export function formatCompactNumber(value: number, maxDecimals = 1): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs < 1000) {
    return `${sign}${Math.round(abs)}`;
  }

  const tiers: ReadonlyArray<{ threshold: number; suffix: string }> = [
    { threshold: 1_000_000_000_000, suffix: 'T' },
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' },
  ];

  const factor = Math.pow(10, Math.max(0, maxDecimals));
  for (let i = 0; i < tiers.length; i++) {
    const { threshold, suffix } = tiers[i];
    if (abs >= threshold) {
      // Truncate toward zero at precision step so 999,990 -> 999.9K rather than rounding up to 1000K
      const scaled = abs / threshold;
      const truncated = Math.floor(scaled * factor) / factor;
      if (truncated >= 1000 && i > 0) {
        const upper = tiers[i - 1];
        return `${sign}1${upper.suffix}`;
      }
      const formatted = truncated.toFixed(maxDecimals).replace(/\.0+$/, '');
      return `${sign}${formatted}${suffix}`;
    }
  }

  return `${sign}${Math.round(abs)}`;
}

export function formatSignedCompact(value: number, maxDecimals = 1): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.5) return '0';
  const core = formatCompactNumber(Math.abs(value), maxDecimals);
  return value > 0 ? `+${core}` : `-${core}`;
}
