/**
 * Ingredient unit conversion — the single source of truth for turning a recipe's US
 * measurements into grams.
 *
 * Weight units (oz, lb, …) convert to grams with fixed factors. Volume units (cup, tbsp,
 * …) can't: a cup of flour and a cup of sugar weigh different amounts, so a volume→grams
 * conversion needs the ingredient's *density* (grams per US cup), looked up by name in the
 * shared `src/data/densities.json` list. Ingredients with no recognised unit (e.g. "1
 * lemon") or an unknown density simply don't convert — callers fall back to the US text.
 *
 * The numeric tables below are also injected into the /upload page's inline script (via
 * `define:vars`) so the uploader and the recipe pages share one set of factors. Keep data
 * in the exported tables; the pure functions are re-implemented compactly there.
 */

/** Map of ingredient name (lowercased) → grams per US cup. */
export type Densities = Record<string, number>;

/** Single Unicode fraction glyph → its decimal value. Covers the ones recipes actually use. */
export const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/** How many US cups one of each volume unit is (1 cup = 236.588 ml = 8 fl oz = 16 tbsp = 48 tsp). */
export const VOLUME_IN_CUPS: Record<string, number> = {
  cup: 1,
  tbsp: 1 / 16,
  tsp: 1 / 48,
  'fl oz': 1 / 8,
  pint: 2,
  quart: 4,
  gallon: 16,
  ml: 1 / 236.588,
  l: 1000 / 236.588,
};

/** Grams per weight unit. Universal — no density needed. */
export const WEIGHT_IN_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
};

/** Spelling/plural variants → canonical unit key used by the tables above. */
export const UNIT_ALIASES: Record<string, string> = {
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  'fl oz': 'fl oz', 'floz': 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  pint: 'pint', pints: 'pint', pt: 'pint',
  quart: 'quart', quarts: 'quart', qt: 'quart',
  gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
};

/** Canonical units offered in the uploader's unit <select>, in a sensible order. */
export const UNIT_OPTIONS: string[] = [
  'cup', 'tbsp', 'tsp', 'fl oz', 'pint', 'quart', 'gallon',
  'oz', 'lb', 'g', 'kg', 'ml', 'l',
];

/** Fold a free-typed unit to its canonical key (lowercase, no trailing period, de-pluralised). */
export function normalizeUnit(unit: string | undefined | null): string {
  if (!unit) return '';
  const key = String(unit).toLowerCase().trim().replace(/\.$/, '');
  return UNIT_ALIASES[key] ?? key;
}

/**
 * Parse a quantity string to a number. Handles integers, decimals, ASCII fractions ("1/2"),
 * Unicode fractions ("¾"), and mixed numbers ("2 ¼", "1 1/2"). Returns null for anything
 * that isn't a single scalar — most importantly ranges like "6-8", which can't be converted.
 */
export function parseQty(qty: string | number | undefined | null): number | null {
  if (qty == null) return null;
  const s = String(qty).trim();
  if (!s) return null;
  // A range (or "1 to 2") isn't one quantity, so there's nothing single to convert.
  if (/[-–—]/.test(s) || /\bto\b/i.test(s)) return null;

  let total = 0;
  let matched = false;

  // Sum any Unicode fraction glyphs, then strip them so a leading whole number remains.
  for (const ch of s) {
    if (ch in UNICODE_FRACTIONS) {
      total += UNICODE_FRACTIONS[ch];
      matched = true;
    }
  }
  const rest = s.replace(/[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, ' ').trim();

  if (rest) {
    const mixed = rest.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/); // "1 1/2"
    const frac = rest.match(/^(\d+)\s*\/\s*(\d+)$/); // "1/2"
    if (mixed) {
      total += Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
      matched = true;
    } else if (frac) {
      total += Number(frac[1]) / Number(frac[2]);
      matched = true;
    } else {
      const n = Number(rest);
      if (!Number.isFinite(n)) return null;
      total += n;
      matched = true;
    }
  }

  return matched ? total : null;
}

/**
 * Look up an ingredient's grams-per-cup density by name, tolerating qualifiers the density
 * list doesn't spell out. Tries the cleaned full name first (so a qualifier that changes the
 * density — "powdered sugar" 120 vs "sugar" 200 — still wins), then progressively drops
 * leading words ("unsalted butter" → "butter", "Greek yogurt" → "yogurt"). Returns null when
 * nothing matches.
 */
export function lookupDensity(name: string | undefined | null, densities: Densities): number | null {
  const clean = String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;

  const words = clean.split(' ');
  for (let i = 0; i < words.length; i++) {
    const candidate = words.slice(i).join(' ');
    if (densities?.[candidate] != null) return densities[candidate];
  }
  return null;
}

/**
 * Convert (qty, unit, name) to grams, or null if it can't be converted:
 *   - weight unit  → qty × fixed factor (density irrelevant);
 *   - volume unit  → qty × cups-per-unit × density[name] (needs a known density);
 *   - anything else (no/unknown unit, unparseable qty) → null.
 */
export function toGrams(
  qty: string | number | undefined | null,
  unit: string | undefined | null,
  name: string | undefined | null,
  densities: Densities
): number | null {
  const u = normalizeUnit(unit);
  if (!u) return null;

  if (u in WEIGHT_IN_GRAMS) {
    const n = parseQty(qty);
    return n == null ? null : n * WEIGHT_IN_GRAMS[u];
  }

  if (u in VOLUME_IN_CUPS) {
    const density = lookupDensity(name, densities);
    if (density == null) return null;
    const n = parseQty(qty);
    return n == null ? null : n * VOLUME_IN_CUPS[u] * density;
  }

  return null;
}

/**
 * Given grams entered for a (qty, unit) of some ingredient, derive its density (grams per
 * cup) for the shared list. Only meaningful for volume units; returns null otherwise.
 */
export function densityFromGrams(
  qty: string | number | undefined | null,
  unit: string | undefined | null,
  grams: number
): number | null {
  const cupsPerUnit = VOLUME_IN_CUPS[normalizeUnit(unit)];
  const n = parseQty(qty);
  if (cupsPerUnit == null || n == null || n <= 0 || !(grams > 0)) return null;
  return grams / (n * cupsPerUnit);
}

/** Human-readable grams label: whole grams once we're past 10 g, otherwise one decimal. */
export function formatGrams(grams: number): string {
  const rounded = grams >= 10 ? Math.round(grams) : Math.round(grams * 10) / 10;
  return `${rounded} g`;
}

/**
 * Append an ingredient's prep detail as a comma clause: ("butter", "softened") → "butter, softened".
 * Shared by the US and grams labels so both render the detail identically.
 */
export function withDetail(text: string, detail?: string): string {
  const d = (detail ?? '').trim();
  return d ? `${text}, ${d}` : text;
}

/** The US-facing "qty unit name" label for a structured ingredient, e.g. "2 ¼ cup flour". */
export function ingredientLabel(item: {
  name: string;
  qty?: string;
  unit?: string;
  detail?: string;
}): string {
  return withDetail([item.qty, item.unit, item.name].filter(Boolean).join(' '), item.detail);
}
