/**
 * Recipe scaling — multiply an authored quantity string by a factor and write it back the way
 * an author would ("2 ¼" × 2 → "4 ½", "6-8" × ½ → "3-4").
 *
 * Quantities are freeform strings (see schema.ts), every one of them rational, and every scale
 * factor is rational too — so every product is exact. Nothing here rounds to a "nice" fraction:
 * ¼ × ⅓ is written "1/12", not snapped to ⅛ (which would be 50% off).
 *
 * Pure, and imports only `./units`, so the client script can pull it in without dragging the
 * markdown renderer along.
 */

import { parseQty } from './units';

export interface ScaleFactor {
  /** Stable handle used in `data-scale-btn` / `data-scale`. */
  id: string;
  value: number;
  /** Short visible label ("½", "2×"). */
  label: string;
  /** Spoken name — "⅓" on its own reads poorly in a screen reader. */
  name: string;
}

/** The factors the scale control offers, smallest first. `'1'` is the authored recipe. */
export const SCALE_FACTORS: readonly ScaleFactor[] = [
  { id: '1/3', value: 1 / 3, label: '⅓', name: 'One third' },
  { id: '1/2', value: 1 / 2, label: '½', name: 'Half' },
  { id: '1', value: 1, label: '1×', name: 'Original amounts' },
  { id: '2', value: 2, label: '2×', name: 'Double' },
  { id: '3', value: 3, label: '3×', name: 'Triple' },
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
  if (scalar !== null) return scalar > 0 ? { lo: scalar } : null;

  // split() with a capture group yields [lo, separator, hi] for exactly one separator.
  const parts = s.split(RANGE_SEPARATOR);
  if (parts.length !== 3) return null;
  const lo = parseQty(parts[0]);
  const hi = parseQty(parts[2]);
  if (lo === null || hi === null || !(lo > 0 && lo < hi)) return null;
  return { lo, hi, sep: parts[1] };
}

/** Whether a quantity can be scaled at all — i.e. whether it is worth marking up for the client. */
export function isScalable(qty: string | undefined | null): boolean {
  return parseAmount(qty) !== null;
}

const EPSILON = 1e-6;

/** Reduced proper fraction → its Unicode glyph. Every "k/d" over 2, 3, 4, 5, 6, 8 has one. */
const FRACTION_GLYPHS: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓', '2/3': '⅔',
  '1/4': '¼', '3/4': '¾',
  '1/5': '⅕', '2/5': '⅖', '3/5': '⅗', '4/5': '⅘',
  '1/6': '⅙', '5/6': '⅚',
  '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞',
};

/** Denominators tried in order: the glyph ones first, then ones written as ASCII "k/d". */
const DENOMINATORS = [2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 24];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Write a positive number as a recipe quantity: a whole number, a fraction, or a mixed number
 * with a space ("2 ¼"), matching how the recipes are authored. The fraction is exact — a glyph
 * where one exists, otherwise ASCII ("1/12", which `parseQty` still reads). A value that is no
 * small fraction at all falls back to two decimals. Returns '' for a non-positive or non-finite
 * number.
 */
export function formatQty(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';

  let whole = Math.floor(n);
  let frac = n - whole;
  if (frac > 1 - EPSILON) {
    whole += 1;
    frac = 0;
  }
  if (frac < EPSILON) return String(whole);

  for (const d of DENOMINATORS) {
    const k = Math.round(frac * d);
    if (Math.abs(frac * d - k) >= EPSILON) continue;
    const g = gcd(k, d);
    const reduced = `${k / g}/${d / g}`;
    const text = FRACTION_GLYPHS[reduced] ?? reduced;
    return whole > 0 ? `${whole} ${text}` : text;
  }

  return String(Number(n.toFixed(2)));
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
  // "1-1 ½" reads as a mixed number gone wrong; a spaced en dash keeps the two ends apart.
  if (lo.includes(' ') || hi.includes(' ')) return `${lo} – ${hi}`;
  return /^to$/i.test(amount.sep ?? '') ? `${lo} to ${hi}` : `${lo}${amount.sep}${hi}`;
}
