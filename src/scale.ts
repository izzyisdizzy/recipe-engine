/**
 * Recipe scaling — multiply an authored quantity string by a factor and write it back the way
 * an author would ("2 ¼" × 2 → "4 ½", "6-8" × ½ → "3-4").
 *
 * Quantities are freeform strings (see schema.ts) and recipes write them as fractions, so a
 * scaled quantity is a fraction too and is written exactly. Nothing here rounds to a "nice"
 * fraction: ¼ × ⅓ is written "1/12", not snapped to ⅛ (which would be 50% off). Only a value
 * that is no small fraction at all — a scaled decimal like "0.33" — is shown as a rounded decimal.
 *
 * Pure, and imports only `./units`, so the client script can pull it in without dragging the
 * markdown renderer along.
 */

import { UNICODE_FRACTIONS, parseQty } from './units';

export interface ScaleFactor {
  /** Stable handle used in `data-scale-btn` / `data-scale`. */
  id: string;
  value: number;
  /** Short visible label ("½", "2×"). */
  label: string;
}

/** The id of the factor that is the recipe as authored. */
export const ORIGINAL_SCALE = '1';

/** The factors the scale control offers, smallest first. */
export const SCALE_FACTORS: readonly ScaleFactor[] = [
  { id: '1/3', value: 1 / 3, label: '⅓' },
  { id: '1/2', value: 1 / 2, label: '½' },
  { id: ORIGINAL_SCALE, value: 1, label: '1×' },
  { id: '2', value: 2, label: '2×' },
  { id: '3', value: 3, label: '3×' },
];

/** A parsed quantity: one value, or a range with the separator the author used. */
export interface Amount {
  lo: number;
  hi?: number;
  sep?: string;
}

const RANGE_SEPARATOR = /\s*([-–—]|\bto\b)\s*/i;

/**
 * Parse a quantity string, ranges included. `parseQty` deliberately returns null for a range
 * (there is no single number to convert to grams); scaling can still handle one by scaling
 * both ends. Returns null for anything else that isn't a positive quantity ("a pinch"), and
 * for an ambiguous "1-1/2", which could be a range or a mixed number.
 */
export function parseAmount(qty: string | undefined | null): Amount | null {
  const s = String(qty ?? '').trim();
  if (!s) return null;

  const scalar = parseQty(s);
  if (scalar !== null) return scalar > 0 && Number.isFinite(scalar) ? { lo: scalar } : null;

  // split() with a capture group yields [lo, separator, hi] for exactly one separator.
  const parts = s.split(RANGE_SEPARATOR);
  if (parts.length !== 3) return null;
  const lo = parseQty(parts[0]);
  const hi = parseQty(parts[2]);
  if (lo === null || hi === null || !(lo > 0 && lo < hi) || !Number.isFinite(hi)) return null;
  return { lo, hi, sep: parts[1] };
}

/** Whether a quantity can be scaled at all — i.e. whether it is worth marking up for the client. */
export function isScalable(qty: string | undefined | null): boolean {
  return parseAmount(qty) !== null;
}

const EPSILON = 1e-6;

/**
 * The largest denominator written as a fraction. 48 keeps every authored fraction exact at
 * every factor (⅛ × ⅓ = 1/24, 1/16 × ⅓ = 1/48, ⅚ × ⅓ = 5/18) while leaving a scaled decimal
 * ("0.33" × 2 = 33/50) to read as a decimal.
 */
const MAX_DENOMINATOR = 48;

/** A proper fraction in lowest terms ("k/d"), or null if it isn't one over a small denominator. */
function asFraction(frac: number): string | null {
  // Smallest denominator first, so the first hit is already reduced.
  for (let d = 2; d <= MAX_DENOMINATOR; d++) {
    const k = Math.round(frac * d);
    if (k > 0 && Math.abs(frac * d - k) < EPSILON) return `${k}/${d}`;
  }
  return null;
}

/** Reduced fraction → its Unicode glyph, inverted from the table `parseQty` reads. */
const FRACTION_GLYPHS: Record<string, string> = Object.fromEntries(
  Object.entries(UNICODE_FRACTIONS).map(([glyph, value]) => [asFraction(value), glyph])
);

/**
 * Write a positive number as a recipe quantity: a whole number, a fraction, or a mixed number
 * with a space ("2 ¼"), matching how the recipes are authored. The fraction is exact — a glyph
 * where one exists, otherwise ASCII ("1/12", which `parseQty` still reads). A value that is no
 * small fraction at all is rounded to a short decimal. Returns '' for a number that is
 * non-finite, non-positive, or too small to write.
 */
export function formatQty(n: number): string {
  if (!Number.isFinite(n) || n < EPSILON) return '';

  let whole = Math.floor(n);
  let frac = n - whole;
  if (frac > 1 - EPSILON) {
    whole += 1;
    frac = 0;
  }
  if (frac < EPSILON) return String(whole);

  const fraction = asFraction(frac);
  if (fraction) {
    const text = FRACTION_GLYPHS[fraction] ?? fraction;
    return whole > 0 ? `${whole} ${text}` : text;
  }

  // Two decimals, or two significant digits for a small value so it never rounds to "0".
  return String(Number(n >= 0.1 ? n.toFixed(2) : n.toPrecision(2)));
}

/**
 * Scale a quantity string by a factor. A factor of 1, or a quantity that can't be parsed,
 * returns the author's string untouched — so 1× is always exactly what was written ("1 1/2"
 * is not normalised to "1 ½"). A range scales both ends and keeps its separator.
 */
export function scaleQty(qty: string, factor: number): string {
  if (factor === 1) return qty;
  const amount = parseAmount(qty);
  if (!amount) return qty;

  const lo = formatQty(amount.lo * factor);
  if (!lo) return qty;
  if (amount.hi === undefined) return lo;

  const hi = formatQty(amount.hi * factor);
  if (!hi) return qty;
  if (lo === hi) return lo;
  if (/^to$/i.test(amount.sep ?? '')) return `${lo} to ${hi}`;
  // "1-1 ½" reads as a mixed number gone wrong; a spaced en dash keeps the two ends apart.
  if (lo.includes(' ') || hi.includes(' ')) return `${lo} – ${hi}`;
  return `${lo}${amount.sep}${hi}`;
}
