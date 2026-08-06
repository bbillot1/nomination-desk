/**
 * Numeric representation helpers (BUILD_SPEC §7.0).
 *
 * Invariants enforced here, not by convention:
 *   - Volumes are integer Dth. Never a fraction, never a float result.
 *   - Money is integer cents. Formatting to dollars happens only at the
 *     presentation edge (`formatUsd`) and inside `formula_string`.
 *   - Rates and percentages are integer basis points. 10000 bps = 100%.
 *   - Division rounds down. Remainder assignment is the caller's job.
 *
 * This module is imported by Deno edge functions and by Node/vitest, so
 * imports elsewhere must carry the explicit `.ts` extension.
 */

export const BPS_SCALE = 10_000;

/** Largest exact integer in an IEEE-754 double. All values here stay far below it. */
const MAX_EXACT = Number.MAX_SAFE_INTEGER;

function assertExactInteger(n: number, label: string): number {
  if (!Number.isInteger(n)) {
    throw new TypeError(`${label} must be an integer, received ${n}`);
  }
  if (Math.abs(n) > MAX_EXACT) {
    throw new RangeError(`${label} exceeds exact-integer range: ${n}`);
  }
  return n;
}

/** Assert a volume is whole Dth. Returns it unchanged so it can wrap expressions. */
export function dth(n: number): number {
  return assertExactInteger(n, "volume (Dth)");
}

/** Assert a money value is whole cents. */
export function cents(n: number): number {
  return assertExactInteger(n, "money (cents)");
}

/** Assert a rate is whole basis points. */
export function bps(n: number): number {
  return assertExactInteger(n, "rate (bps)");
}

/**
 * Integer division rounding toward negative infinity.
 * `Math.floor` on the quotient is exact for all magnitudes used in this system.
 */
export function floorDiv(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError("division by zero");
  assertExactInteger(numerator, "numerator");
  assertExactInteger(denominator, "denominator");
  return Math.floor(numerator / denominator);
}

/**
 * Apply a basis-point deviation to a whole quantity, rounding down.
 * `applyBps(36000, -139) === 35499`
 */
export function applyBps(quantity: number, deviationBps: number): number {
  dth(quantity);
  bps(deviationBps);
  return floorDiv(quantity * (BPS_SCALE + deviationBps), BPS_SCALE);
}

/**
 * Portion of `quantity` at a rate expressed in basis points, rounded down.
 * `portionOfBps(250000, 500) === 12500`  (5% tolerance band)
 */
export function portionOfBps(quantity: number, rateBps: number): number {
  dth(quantity);
  bps(rateBps);
  return floorDiv(quantity * rateBps, BPS_SCALE);
}

/**
 * Ratio of two integers as basis points, rounded half-away-from-zero.
 * Used only for reporting; never fed back into further arithmetic.
 */
export function ratioBps(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError("ratio with zero denominator");
  const scaled = (numerator * BPS_SCALE) / denominator;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/**
 * Render basis points as a decimal string with `places` digits.
 * `formatFactor(3600)` -> "0.3600"
 */
export function formatFactor(rateBps: number, places = 4): string {
  bps(rateBps);
  return (rateBps / BPS_SCALE).toFixed(places);
}

/**
 * Render basis points as a signed percentage string.
 * `formatPct(1500)` -> "+15.0%"; `formatPct(-139)` -> "-1.4%"
 */
export function formatPct(rateBps: number, places = 1): string {
  bps(rateBps);
  const pct = rateBps / 100;
  const sign = rateBps > 0 ? "+" : rateBps < 0 ? "-" : "";
  return `${sign}${Math.abs(pct).toFixed(places)}%`;
}

/** Group an integer with thousands separators. `formatDth(287500)` -> "287,500" */
export function formatDth(volume: number): string {
  dth(volume);
  return volume.toLocaleString("en-US");
}

/**
 * Render integer cents as US dollars. The only place money becomes a string.
 * `formatUsd(62500000)` -> "$625,000.00"
 */
export function formatUsd(amountCents: number): string {
  cents(amountCents);
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);
  const whole = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${whole.toLocaleString("en-US")}.${fraction}`;
}

/**
 * Render a per-Dth rate in cents as US dollars. `formatRate(2500)` -> "$25.00"
 */
export function formatRate(rateCents: number): string {
  return formatUsd(rateCents);
}

/** Sum a list of integers, asserting the result stays exact. */
export function sumExact(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += assertExactInteger(v, "summand");
  return assertExactInteger(total, "sum");
}
