import { describe, expect, it } from 'vitest';
import densities from '../seed/densities.json';
import { MIN_QUERY_LENGTH, rankIngredientSuggestions } from './ingredient-suggest';

// The real pool the uploader offers, so these tests fail if densities.json loses a key the
// typeahead's behaviour is pinned to.
const NAMES = Object.keys(densities);

/** Just the names, in rank order — the shape most assertions care about. */
const rank = (q: string, limit?: number) =>
  rankIngredientSuggestions(q, NAMES, limit).map((s) => s.name);

describe('query threshold', () => {
  it('ignores a query shorter than the minimum', () => {
    expect(MIN_QUERY_LENGTH).toBe(2);
    expect(rank('b')).toEqual([]);
    expect(rank('')).toEqual([]);
    expect(rank('   ')).toEqual([]);
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(rank('BA')).toEqual(rank('ba'));
    expect(rank('  Ba  ')).toEqual(rank('ba'));
  });

  it('returns nothing for a query that matches no ingredient', () => {
    expect(rank('zzz')).toEqual([]);
  });
});

describe('prefix matches (tier 0)', () => {
  it('completes "ba" to baking powder before baking soda', () => {
    // The requested example, and the guard on the alphabetical tie-break: ranking by length
    // would put the shorter "baking soda" first and break it.
    expect(rank('ba')).toEqual(['baking powder', 'baking soda']);
  });

  it('marks whole-name prefixes as completable', () => {
    expect(rankIngredientSuggestions('ba', NAMES)).toEqual([
      { name: 'baking powder', isPrefix: true },
      { name: 'baking soda', isPrefix: true },
    ]);
  });

  it('ranks a prefix hit above a word-boundary hit that sorts earlier', () => {
    // "sugar" is a prefix hit and "brown sugar" a later-word hit; alphabetically "brown"
    // comes first, so this only passes because the tier outranks the sort.
    expect(rank('sug', 2)).toEqual(['sugar', 'brown sugar']);
  });
});

describe('word-boundary matches (tier 1)', () => {
  it('surfaces the variant family from a head noun', () => {
    // "flour" is itself a key, so it drops out as an exact hit and leaves its variants —
    // which is the useful answer when the field already reads "flour".
    expect(rank('flour')).toEqual([
      '00 flour',
      'all purpose flour',
      'bread flour',
      'cake flour',
    ]);
  });

  it('keeps the bare name when it is only a prefix, not an exact hit', () => {
    expect(rank('sug')).toEqual([
      'sugar',
      'brown sugar',
      'demerara sugar',
      'granulated sugar',
      'light brown sugar',
      'powdered sugar',
    ]);
  });

  it('offers the qualified form when the bare name is typed in full', () => {
    // "cinnamon" itself is dropped as an exact hit, leaving the variant worth completing to.
    expect(rank('cinnamon')).toEqual(['ground cinnamon']);
  });

  it('does not mark a later-word match as inline-completable', () => {
    const oils = rankIngredientSuggestions('oil', NAMES);
    expect(oils.map((s) => s.name)).toEqual([
      'canola oil',
      'olive oil',
      'sesame oil',
      'vegetable oil',
    ]);
    expect(oils.every((s) => s.isPrefix)).toBe(false);
  });
});

describe('substring matches (tier 2)', () => {
  it('falls back to a bare substring, never as a prefix', () => {
    expect(rankIngredientSuggestions('oco', NAMES)).toEqual([
      { name: 'chocolate chips', isPrefix: false },
      { name: 'cocoa powder', isPrefix: false },
    ]);
  });
});

describe('exact matches', () => {
  it('drops a name equal to the query, since there is nothing left to complete', () => {
    expect(rank('baking powder')).toEqual([]);
    expect(rank('  BAKING POWDER ')).toEqual([]);
  });
});

describe('limit', () => {
  it('caps the list', () => {
    expect(rank('sug', 2)).toEqual(['sugar', 'brown sugar']);
    expect(rank('sug', 0)).toEqual([]);
  });

  it('fills the cap from the best tiers first', () => {
    expect(rank('flour', 2)).toEqual(['00 flour', 'all purpose flour']);
  });
});

describe('input tolerance', () => {
  it('dedupes and skips blank candidates without throwing', () => {
    const messy = ['baking powder', 'Baking Powder', '', '  ', 'baking soda'];
    expect(rankIngredientSuggestions('ba', messy).map((s) => s.name)).toEqual([
      'baking powder',
      'baking soda',
    ]);
  });
});
