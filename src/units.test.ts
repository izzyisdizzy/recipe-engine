import { describe, it, expect } from 'vitest';
import { ingredientLabel, withDetail, lookupDensity, type Densities } from './units';

describe('withDetail', () => {
  it('appends a detail as a comma clause', () => {
    expect(withDetail('butter', 'softened')).toBe('butter, softened');
  });

  it('returns the text untouched when there is no detail', () => {
    expect(withDetail('butter')).toBe('butter');
    expect(withDetail('butter', '')).toBe('butter');
  });

  it('ignores a whitespace-only detail', () => {
    expect(withDetail('butter', '   ')).toBe('butter');
  });

  it('trims a padded detail', () => {
    expect(withDetail('butter', '  softened  ')).toBe('butter, softened');
  });
});

describe('ingredientLabel', () => {
  it('builds the plain qty/unit/name label', () => {
    expect(ingredientLabel({ name: 'flour', qty: '1 ½', unit: 'cup' })).toBe('1 ½ cup flour');
  });

  it('appends a detail after the name', () => {
    expect(ingredientLabel({ name: 'butter', qty: '½', unit: 'cup', detail: 'softened' })).toBe(
      '½ cup butter, softened'
    );
  });

  it('appends a detail to a count item with no unit', () => {
    expect(ingredientLabel({ name: 'eggs', qty: '4', detail: 'room temp' })).toBe('4 eggs, room temp');
  });

  it('appends a detail to a bare name with no qty or unit', () => {
    expect(ingredientLabel({ name: 'cheddar cheese', detail: 'grated' })).toBe('cheddar cheese, grated');
  });

  it('is unchanged for an item without a detail', () => {
    expect(ingredientLabel({ name: 'brown sugar', qty: '½', unit: 'cup' })).toBe('½ cup brown sugar');
  });
});

// The detail split only pays off if `name` is then a clean lookup key. These pin the property
// that migrating "butter, softened" to name + detail leaves the density lookup untouched.
describe('lookupDensity after the detail split', () => {
  const densities: Densities = { butter: 227, flour: 120, 'greek yogurt': 230 };

  it('resolves the same for a comma-in-name and a split name', () => {
    expect(lookupDensity('butter, softened', densities)).toBe(227);
    expect(lookupDensity('butter', densities)).toBe(227);
  });

  it('still drops leading qualifiers', () => {
    expect(lookupDensity('unsalted butter', densities)).toBe(227);
  });

  it('returns null for an unknown name', () => {
    expect(lookupDensity('tahini', densities)).toBeNull();
  });
});
