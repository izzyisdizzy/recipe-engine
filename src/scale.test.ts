import { describe, it, expect } from 'vitest';
import { SCALE_FACTORS, parseAmount, formatQty, scaleQty, isScalable } from './scale';
import { UNICODE_FRACTIONS } from './units';

// Every quantity shape the site's recipes actually use.
const CONTENT_QTYS = [
  '1', '2', '24',
  '½', '¼', '⅓', '⅔', '¾',
  '1/2', '1/4', '3/4', '1/3',
  '1 ½', '2 ½', '2 ¼', '1 ¾',
  '3 1/2', '1 3/4', '1 1/2',
  '6-8', '5-6', '3-6', '2-3', '1-2',
];

describe('SCALE_FACTORS', () => {
  it('offers ⅓ ½ 1× 2× 3×, with the authored recipe as id "1"', () => {
    expect(SCALE_FACTORS.map((f) => f.id)).toEqual(['1/3', '1/2', '1', '2', '3']);
    expect(SCALE_FACTORS.find((f) => f.id === '1')!.value).toBe(1);
  });
});

describe('parseAmount', () => {
  it.each([
    ['2', 2],
    ['½', 0.5],
    ['1/2', 0.5],
    ['2 ¼', 2.25],
    ['1 1/2', 1.5],
    ['  3  ', 3],
  ])('reads the scalar %j', (qty, lo) => {
    expect(parseAmount(qty)).toEqual({ lo });
  });

  it.each([
    ['6-8', { lo: 6, hi: 8, sep: '-' }],
    ['2–3', { lo: 2, hi: 3, sep: '–' }],
    ['1 to 2', { lo: 1, hi: 2, sep: 'to' }],
    ['½ - 1', { lo: 0.5, hi: 1, sep: '-' }],
  ])('reads the range %j', (qty, expected) => {
    expect(parseAmount(qty)).toEqual(expected);
  });

  it.each(['', '   ', undefined, null, 'a pinch', 'about 2', '0', '8-6', '2-2', '1-2-3', '1-1/2'])(
    'returns null for %j',
    (qty) => {
      expect(parseAmount(qty)).toBeNull();
    }
  );

  it('agrees with isScalable', () => {
    expect(isScalable('6-8')).toBe(true);
    expect(isScalable('1 ½')).toBe(true);
    expect(isScalable('to taste')).toBe(false);
    expect(isScalable(undefined)).toBe(false);
  });
});

describe('formatQty', () => {
  it.each([
    [1, '1'],
    [48, '48'],
    [0.5, '½'],
    [1 / 3, '⅓'],
    [2 / 3, '⅔'],
    [0.2, '⅕'],
    [1 / 6, '⅙'],
    [0.125, '⅛'],
    [0.875, '⅞'],
    [2.25, '2 ¼'],
    [4.5, '4 ½'],
  ])('writes %d as %j', (n, text) => {
    expect(formatQty(n)).toBe(text);
  });

  it('writes a fraction with no glyph as exact ASCII rather than rounding it', () => {
    expect(formatQty(1 / 12)).toBe('1/12');
    expect(formatQty(1 / 16)).toBe('1/16');
    expect(formatQty(3 / 16)).toBe('3/16');
    expect(formatQty(10 / 9)).toBe('1 1/9');
  });

  it('absorbs float error on either side of a whole number', () => {
    expect(formatQty(3 * (1 / 3))).toBe('1');
    expect(formatQty(2.9999999)).toBe('3');
    expect(formatQty(3.0000001)).toBe('3');
  });

  it('falls back to two decimals when no small fraction fits', () => {
    expect(formatQty(1.37)).toBe('1.37');
  });

  it('returns an empty string for a non-positive or non-finite number', () => {
    expect(formatQty(0)).toBe('');
    expect(formatQty(-1)).toBe('');
    expect(formatQty(NaN)).toBe('');
    expect(formatQty(Infinity)).toBe('');
  });

  it('only ever emits glyphs that parseQty can read back', () => {
    for (const d of [2, 3, 4, 5, 6, 8]) {
      for (let k = 1; k < d; k++) {
        const text = formatQty(k / d);
        expect(text in UNICODE_FRACTIONS, `${k}/${d} → ${text}`).toBe(true);
      }
    }
  });
});

describe('scaleQty', () => {
  it.each(CONTENT_QTYS)('returns %j untouched at 1×', (qty) => {
    expect(scaleQty(qty, 1)).toBe(qty);
  });

  it.each([
    ['1', 1 / 3, '⅓'],
    ['3', 1 / 3, '1'],
    ['½', 2, '1'],
    ['¼', 1 / 3, '1/12'],
    ['⅓', 3, '1'],
    ['2 ¼', 2, '4 ½'],
    ['1 ½', 3, '4 ½'],
    ['1 1/2', 1 / 2, '¾'],
    ['3 1/2', 2, '7'],
    ['24', 1 / 2, '12'],
  ])('scales %j by %d to %j', (qty, factor, expected) => {
    expect(scaleQty(qty, factor)).toBe(expected);
  });

  it('scales both ends of a range and keeps its separator', () => {
    expect(scaleQty('6-8', 1 / 2)).toBe('3-4');
    expect(scaleQty('6-8', 3)).toBe('18-24');
    expect(scaleQty('2–3', 2)).toBe('4–6');
    expect(scaleQty('1 to 2', 3)).toBe('3 to 6');
  });

  it('spaces the dash when an end becomes a mixed number', () => {
    expect(scaleQty('2-3', 1 / 2)).toBe('1 – 1 ½');
    expect(scaleQty('5-6', 1 / 2)).toBe('2 ½ – 3');
  });

  it('leaves an unparseable quantity alone', () => {
    expect(scaleQty('a pinch', 2)).toBe('a pinch');
    expect(scaleQty('', 2)).toBe('');
    expect(scaleQty('1-1/2', 2)).toBe('1-1/2');
  });

  it('round-trips: every content quantity at every factor parses back to the scaled value', () => {
    for (const qty of CONTENT_QTYS) {
      const original = parseAmount(qty)!;
      for (const { value } of SCALE_FACTORS) {
        const scaled = parseAmount(scaleQty(qty, value));
        expect(scaled, `${qty} × ${value}`).not.toBeNull();
        expect(scaled!.lo).toBeCloseTo(original.lo * value, 6);
        if (original.hi !== undefined) expect(scaled!.hi).toBeCloseTo(original.hi * value, 6);
      }
    }
  });
});
