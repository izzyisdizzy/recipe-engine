/**
 * Ingredient ↔ step linking. Recipe ingredients are structured `{ name, qty?, unit? }`
 * (see schema.ts); steps are free-form prose that name those ingredients. This
 * module builds a name→measurement index from a recipe's ingredients and rewrites step
 * HTML so each ingredient mention becomes a bold hover/tap target showing its measurement.
 *
 * Matching is lexical and works from the ingredient's stored name, which is often more
 * qualified than the step prose ("granulated sugar" vs "sugar", "vanilla bean paste" vs
 * "vanilla"). To bridge that gap each ingredient registers several surface forms:
 *   - the full name (specific);
 *   - every trailing suffix / "head noun" ("vegetable oil" → "oil") (generic);
 *   - the name with leading qualifiers or a trailing descriptor stripped
 *     ("vanilla bean paste" → "vanilla", "unsalted butter" → "butter") (generic).
 * When a prose word matches, a *specific* (full-name) match always wins over *generic*
 * aliases — so a recipe with a plain "sugar" resolves "sugar" to that, while a recipe with
 * only "granulated sugar" + "powdered sugar" resolves "sugar" to both (shown with labels).
 *
 * All logic is pure and build-time (Astro SSG) — no client parsing.
 */

import { UNICODE_FRACTIONS, UNIT_ALIASES } from './units';

export interface StructuredItem {
  name: string;
  qty?: string;
  unit?: string;
  /** Prep note ("softened"). Carried for typing only — popovers show amounts, not prep. */
  detail?: string;
}

export interface IngredientGroup {
  group?: string;
  items: StructuredItem[];
}

/** One measured occurrence of an ingredient — its name, US + grams amounts, and group. */
interface Entry {
  name: string;
  us: string;
  grams: string | null;
  group?: string;
}

/** Entries reachable by a surface form, split by how precisely they matched it. */
interface FormEntries {
  specific: Entry[];
  generic: Entry[];
}

export interface IngredientIndex {
  /** Surface form → the entries it resolves to, by specificity. */
  forms: Map<string, FormEntries>;
  /** Combined, longest-match-first matcher over all forms, or null when nothing indexable. */
  regex: RegExp | null;
  /**
   * Phrases a mention may sit inside without really being that ingredient — the recipe's own
   * tool names ("Egg beater" contains "egg"). Such mentions don't take an inline amount, so
   * a step never reads "mix with 1 egg beater". Null when the recipe lists no tools.
   */
  avoid: RegExp | null;
}

/**
 * Leading words describing preparation or type that step prose routinely drops
 * ("unsalted butter" → "butter", "granulated sugar" → "sugar"). Stripping these only ever
 * produces a *generic* alias, so it never overrides a real ingredient of the bare name.
 */
const LEADING_STRIP = new Set([
  // preparation
  'softened', 'melted', 'chopped', 'finely', 'coarsely', 'ground', 'packed', 'sifted',
  'diced', 'minced', 'shredded', 'grated', 'peeled', 'beaten', 'crushed', 'toasted',
  'sliced', 'halved', 'quartered', 'cubed', 'drained', 'rinsed', 'trimmed', 'thinly',
  'roughly', 'ripe', 'cold', 'warm', 'hot', 'boneless', 'skinless',
  // size / type qualifiers dropped in prose
  'small', 'medium', 'large', 'unsalted', 'salted', 'vegetable', 'granulated', 'greek',
  'loose', 'fresh', 'dried', 'whole', 'light', 'dark', 'heavy', 'all', 'purpose',
]);

/** Trailing descriptors to peel so a front-distinctive name yields its everyday alias. */
const TRAILING_FORMS = ['bean paste', 'tea leaves', 'paste', 'extract', 'leaves', 'puree'];

/** Too-generic surface forms to never register as match targets. */
const STOP_FORMS = new Set([
  'paste', 'extract', 'leaves', 'grey', 'bean', 'ingredient', 'ingredients', 'temp',
  'purpose', 'powder', 'soda', 'water',
]);

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Collapse whitespace and lowercase — the normal form used for all name comparisons. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Quantity-already-in-the-prose matcher. A step that says "add 1 cup of the flour" or
 * "beat in 2 eggs" has already stated an amount, so prefixing the ingredient's own
 * measurement would read as "add 1 cup of the 1 ½ cup flour". These parts detect a
 * quantity run that reaches right up to the mention; such mentions keep the popover
 * instead of taking an inline amount.
 *
 * Deliberately biased toward suppression: a miss is a visible duplicated amount, while an
 * over-suppression merely leaves today's hover behaviour in place.
 */
const FRACTION_GLYPHS = `[${Object.keys(UNICODE_FRACTIONS).join('')}]`;

/** Spelled-out quantities recipes use instead of digits ("half the apples", "a pinch"). */
const NUMBER_WORDS = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|dozen|half|couple|few|several';

/** Integer/decimal, range ("6-8"), ASCII fraction ("1/2"), glyph ("½"), mixed ("1 ½"), or word. */
const NUMBER =
  `(?:\\d+(?:\\.\\d+)?(?:\\s*[-–—]\\s*\\d+(?:\\.\\d+)?)?(?:\\s*\\/\\s*\\d+)?(?:\\s*${FRACTION_GLYPHS})?` +
  `|${FRACTION_GLYPHS}|(?:${NUMBER_WORDS})(?![\\w]))`;

/** Measure words recipes use in prose that aren't convertible units, so aren't in UNIT_ALIASES. */
const PROSE_UNITS = [
  'pinch', 'pinches', 'dash', 'dashes', 'handful', 'handfuls', 'splash', 'splashes',
  'stick', 'sticks', 'clove', 'cloves', 'can', 'cans', 'package', 'packages',
  'slice', 'slices', 'piece', 'pieces', 'bunch', 'bunches', 'sprig', 'sprigs',
];

/** Words that may sit between a stated quantity and the ingredient it measures. */
const QTY_FILLER = [
  'of', 'the', 'that', 'your', 'more', 'extra', 'additional', 'remaining', 'reserved', 'rest',
  ...LEADING_STRIP,
];

/**
 * One run of measure-or-filler words, longest first so "fluid ounces" wins over "ounces".
 * Repeatable, so "half of the can of |pumpkin" and "2 tbsp. of the sifted |flour" both reach
 * the mention, while "bake 50 minutes, then fold in |butter" breaks at "minutes".
 */
const MEASURE_WORDS = [...Object.keys(UNIT_ALIASES), ...PROSE_UNITS, ...QTY_FILLER]
  .sort((a, b) => b.length - a.length)
  .map((w) => escapeRegex(w).replace(/ /g, '\\s+'))
  .join('|');

/**
 * "Oil the pan", "Butter the dish", "Salt the water" — an ingredient word directly followed by
 * a determiner is a verb, not a use of the ingredient. Inlining there produces "3 tbsp Oil the
 * pan", and worse, spends the ingredient's one inline slot before its real mention.
 */
const VERB_USE = /^\s+(?:the|a|an|your|it|them|this|that)\b/i;

/** True when the text immediately preceding a mention already states a quantity. */
const PRECEDING_QTY = new RegExp(
  `(?:^|[\\s(\\[])${NUMBER}(?:\\s*(?:${MEASURE_WORDS})(?![\\w])\\.?)*\\s*$`,
  'i'
);

/** Ingredient's US measurement label, e.g. "½ cup", "8 tbsp", or "4" for count items. */
function measurementLabel(item: StructuredItem): string {
  return [item.qty, item.unit].map((v) => (v ?? '').trim()).filter(Boolean).join(' ');
}

/** Canonical ingredient name: drop a parenthetical, a comma-note, and normalise. */
function cleanName(name: string): string {
  const noParen = name.replace(/\([^)]*\)/g, ' ');
  return norm((noParen.split(',')[0] ?? '').trim());
}

/** Remove leading qualifier words (keeps at least the final word). */
function stripLeading(name: string): string {
  const words = name.split(' ');
  let i = 0;
  while (i < words.length - 1 && LEADING_STRIP.has(words[i])) i++;
  return words.slice(i).join(' ');
}

/** Peel trailing descriptor words: "vanilla bean paste" → "vanilla". */
function stripTrailing(name: string): string {
  let out = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const tail of TRAILING_FORMS) {
      if (out === tail) return '';
      if (out.endsWith(` ${tail}`)) {
        out = out.slice(0, -tail.length - 1).trim();
        changed = true;
        break;
      }
    }
  }
  return out;
}

function singularize(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y');
  if (/(ses|xes|zes|ches|shes|oes)$/.test(word)) return word.replace(/es$/, '');
  if (/ss$/.test(word)) return word;
  if (/s$/.test(word)) return word.replace(/s$/, '');
  return word;
}

function pluralize(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.replace(/y$/, 'ies');
  if (/(s|x|z|ch|sh|o)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/** A phrase plus singular/plural variants of its last word, for both-way number matching. */
function phraseForms(phrase: string): string[] {
  const words = phrase.split(' ');
  const last = words[words.length - 1];
  const base = singularize(last);
  const variants = [...new Set([last, base, pluralize(base)])];
  const head = words.slice(0, -1);
  return variants.map((w) => [...head, w].join(' '));
}

/** Generic alias phrases for a canonical name: head nouns + leading/trailing-stripped forms. */
function genericAliases(canonical: string): Set<string> {
  const out = new Set<string>();
  const words = canonical.split(' ');
  for (let i = 1; i < words.length; i++) out.add(words.slice(i).join(' ')); // head-noun suffixes

  const lead = stripLeading(canonical);
  if (lead && lead !== canonical) out.add(lead);

  const pre = stripTrailing(canonical);
  if (pre && pre !== canonical) {
    out.add(pre);
    const preLead = stripLeading(pre);
    if (preLead) out.add(preLead);
  }
  return out;
}

/**
 * Build the surface-form index for one recipe's ingredient groups. Items with no
 * measurement (e.g. "Oil spray") are skipped. A name appearing in multiple groups — or
 * several qualified names sharing one generic alias — surfaces all their measurements.
 */
export function buildIngredientIndex(
  groups: IngredientGroup[],
  gramsOf?: (item: StructuredItem) => string | null,
  avoidPhrases: string[] = []
): IngredientIndex {
  const forms = new Map<string, FormEntries>();

  const add = (form: string, entry: Entry, specific: boolean) => {
    const key = norm(form);
    if (key.length < 2 || STOP_FORMS.has(key)) return;
    const rec = forms.get(key) ?? { specific: [], generic: [] };
    (specific ? rec.specific : rec.generic).push(entry);
    forms.set(key, rec);
  };

  for (const g of groups) {
    for (const item of g.items) {
      const us = measurementLabel(item);
      if (!us) continue;
      const canonical = cleanName(item.name);
      if (!canonical) continue;
      const grams = gramsOf ? gramsOf(item) : null;
      const entry: Entry = { name: canonical, us, grams, group: g.group };

      for (const f of phraseForms(canonical)) add(f, entry, true);
      for (const alias of genericAliases(canonical)) {
        for (const f of phraseForms(alias)) add(f, entry, false);
      }
    }
  }

  return {
    forms,
    regex: buildRegex([...forms.keys()]),
    avoid: buildRegex(avoidPhrases.map(norm).filter((p) => p.length > 1)),
  };
}

/** Combined, word-boundary-anchored, longest-match-first regex over all surface forms. */
function buildRegex(forms: string[]): RegExp | null {
  if (forms.length === 0) return null;
  const alternation = forms
    .sort((a, b) => b.length - a.length) // longest first → "granulated sugar" beats "sugar"
    .map((form) => form.split(' ').map(escapeRegex).join('\\s+'))
    .join('|');
  return new RegExp(`\\b(${alternation})\\b`, 'gi');
}

/** Identity of one measured occurrence — used both to dedupe and to track first mentions. */
const entryKey = (e: Entry): string => `${e.name}|${e.us}|${e.grams ?? ''}|${e.group ?? ''}`;

/**
 * How many distinct ingredients a surface form could mean, across both specificity tiers.
 *
 * `resolve()` deliberately lets a specific (full-name) hit shadow generic aliases, which is
 * the right call for a popover the reader opened on purpose. It is the wrong call for text
 * asserted inline: a recipe with both "cake flour" and "flour" resolves a bare "flour" to the
 * latter, so inlining would print the streusel's ¼ cup into a batter that wants 2 cups. So
 * inline amounts require a form that is unambiguous *before* shadowing. Counting by entry key
 * matters because one ingredient can register the same form by several routes ("all purpose
 * flour" reaches "flour" as both a head-noun suffix and a leading-strip alias).
 */
function candidateCount(index: IngredientIndex, matched: string): number {
  const rec = index.forms.get(norm(matched));
  if (!rec) return 0;
  const seen = new Set<string>();
  for (const e of [...rec.specific, ...rec.generic]) seen.add(entryKey(e));
  return seen.size;
}

/** Resolve a matched surface form to its entries: a specific (full-name) hit wins over aliases. */
function resolve(index: IngredientIndex, matched: string): Entry[] {
  const rec = index.forms.get(norm(matched));
  if (!rec) return [];
  const chosen = rec.specific.length > 0 ? rec.specific : rec.generic;
  const seen = new Set<string>();
  return chosen.filter((e) => {
    const k = entryKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The amount cell for one entry. Carries both US and (when known) grams text; which one
 * shows is driven by the page's `data-units` mode via CSS. A cell with a grams equivalent is
 * marked `.ing-conv` so grams mode can hide only its US text (count/unknown items stay US).
 */
function amountHtml(e: Entry): string {
  const us = `<span class="ing-us">${escapeHtml(e.us)}</span>`;
  const grams = e.grams ? `<span class="ing-grams">${escapeHtml(e.grams)}</span>` : '';
  return `<span class="ing-amt${e.grams ? ' ing-conv' : ''}">${us}${grams}</span>`;
}

/**
 * The interactive trigger + measurement popover for one matched ingredient mention.
 *
 * When `inline` is set the mention also carries a second, *visible-on-demand* rendering of
 * the same amount placed before the name, so "mix in butter" can read "mix in ½ cup butter".
 * It ships `display: none` (see global.css), which makes the default and no-JS page
 * identical to the popover-only one; `aria-hidden` matches that hidden default and the
 * amounts toggle lifts it when the copy becomes the only source of the measurement.
 */
function buildTrigger(label: string, entries: Entry[], id: number, inline = false): string {
  const popId = `ing-pop-${id}`;
  // A single measurement shows just the amount; group labels only earn their place when
  // they disambiguate between multiple measurements of the same mention.
  const inner =
    entries.length === 1
      ? amountHtml(entries[0])
      : entries
          .map(
            (e) =>
              `<span class="ing-pop-row">${amountHtml(e)} <span class="ing-pop-group">· ${escapeHtml(e.group ?? e.name)}</span></span>`
          )
          .join('');
  // The separating space lives *inside* the copy so nothing is left behind when it is hidden.
  const inlineCopy = inline ? `<span class="ing-inline" aria-hidden="true">${amountHtml(entries[0])} </span>` : '';
  return (
    `<span class="ing-ref${inline ? ' ing-has-amt' : ''}">` +
    inlineCopy +
    `<button type="button" class="ing-ref-btn" aria-expanded="false" aria-describedby="${popId}">${escapeHtml(label)}</button>` +
    `<span role="tooltip" id="${popId}" class="ing-pop">${inner}</span>` +
    `</span>`
  );
}

/**
 * Per-page state threaded through every step of a recipe, in render order. It carries the
 * popover id counter, the set of ingredients that have already been given an inline amount
 * (only an ingredient's *first* mention gets one), and a count of how many mentions
 * actually took one — which is what tells the layout whether to render the amounts toggle.
 */
export interface LinkState {
  n: number;
  inlineable?: number;
  seen?: Set<string>;
}

export function createLinkState(): LinkState {
  return { n: 0, inlineable: 0, seen: new Set() };
}

/**
 * Rewrite already-rendered step HTML, wrapping ingredient mentions in popover triggers.
 *
 * Runs on the HTML produced by inlineMarkdown (markdown-first): the tokenizer only ever
 * touches plain-text runs, so it can't corrupt tags or entities, and it skips text inside
 * <a>/<code> to avoid nesting a button in a link or mangling code. `state` threads a
 * per-page counter so every popover gets a unique id across all steps.
 *
 * A mention additionally gets an inline copy of its amount when all three hold:
 *   - it resolves to exactly one measurement (a multi-row list can't go in a sentence);
 *   - the prose doesn't already state a quantity for it (see PRECEDING_QTY);
 *   - it is the first such mention of that ingredient on the page.
 * Because the second condition is checked before the third, a mention the guard skips does
 * not consume the ingredient's one inline slot — a later, unqualified mention still gets it.
 */
export function linkIngredientsInHtml(
  html: string,
  index: IngredientIndex,
  state: LinkState = createLinkState()
): string {
  const { regex } = index;
  if (!regex) return html;

  const seen = (state.seen ??= new Set<string>());
  state.inlineable ??= 0;

  let skipDepth = 0;
  // Plain text seen so far in this step, used to look behind a match for a stated quantity.
  // Tags and entities collapse to a space: they never carry a quantity themselves, and a
  // space keeps "add <strong>2 cups</strong> flour" readable as one run to the matcher.
  let carry = '';

  // Split into tags, entities, and the text between them; odd matches are tags/entities.
  return html
    .split(/(<[^>]+>|&[^;\s]+;)/)
    .map((token) => {
      if (!token) return token;

      if (token[0] === '<') {
        carry += ' ';
        if (/^<(a|code)[\s>]/i.test(token)) skipDepth++;
        else if (/^<\/(a|code)>/i.test(token) && skipDepth > 0) skipDepth--;
        return token;
      }
      if (token[0] === '&') {
        carry += ' ';
        return token; // HTML entity — leave untouched
      }

      const before = carry;
      carry += token;
      if (skipDepth > 0) return token; // inside <a>/<code>

      // Spans of this token covered by an avoid phrase (a tool name); a mention starting
      // inside one is a coincidence of wording, not a real use of the ingredient.
      const avoided: Array<[number, number]> = [];
      if (index.avoid) {
        index.avoid.lastIndex = 0;
        for (let m = index.avoid.exec(token); m !== null; m = index.avoid.exec(token)) {
          avoided.push([m.index, m.index + m[0].length]);
        }
      }

      return token.replace(regex, (match: string, _form: string, offset: number) => {
        const entries = resolve(index, match);
        if (entries.length === 0) return match;

        const inline =
          entries.length === 1 &&
          candidateCount(index, match) === 1 &&
          !avoided.some(([a, b]) => offset >= a && offset < b) &&
          !VERB_USE.test(token.slice(offset + match.length)) &&
          !PRECEDING_QTY.test(before + token.slice(0, offset)) &&
          !seen.has(entryKey(entries[0]));
        if (inline) {
          seen.add(entryKey(entries[0]));
          state.inlineable = (state.inlineable ?? 0) + 1;
        }
        return buildTrigger(match, entries, state.n++, inline);
      });
    })
    .join('');
}
