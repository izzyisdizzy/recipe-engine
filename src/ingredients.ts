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
 * Steps can also name an ingredient explicitly as `[[key]]` or `[[key|display text]]` (see
 * `linkStep`). An explicit reference resolves to exactly that item — no guessing — and prose
 * without brackets keeps the lexical matching above, so existing recipes need no migration.
 *
 * All logic is pure and build-time (Astro SSG) — no client parsing.
 */

import { UNICODE_FRACTIONS, UNIT_ALIASES } from './units';
import { inlineMarkdown } from './markdown';
import { isScalable } from './scale';

export interface StructuredItem {
  name: string;
  qty?: string;
  unit?: string;
  /** Prep note ("softened"). Carried for typing only — popovers show amounts, not prep. */
  detail?: string;
  /** Handle for `[[key]]` step references; defaults to the slug of `name`. */
  key?: string;
  /** Grams override; the caller's `gramsOf` decides whether to honour it. */
  grams?: number;
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
  /** Raw values for the scale control — set only when the index is built with `ScaleData`. */
  qty?: string;
  unit?: string;
  gramsValue?: number | null;
}

/**
 * Opt-in data for client-side scaling (client/recipe-scale.ts). Passing it makes every
 * generated amount carry its authored quantity (`data-qty` / `data-unit`) and unrounded grams
 * (`data-grams`) as attributes; the visible text is unchanged.
 */
export interface ScaleData {
  /** Numeric grams for an item — scaled from this, not from the rounded label. */
  gramsOf?: (item: StructuredItem) => number | null;
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
  /**
   * Ingredient key → every item registered under it, for `[[key]]` references. More than one
   * candidate means two items share a default key (the same name in two groups) and a
   * reference to it is ambiguous. `entry` is null for an unmeasured item ("Salt to taste").
   */
  keys: Map<string, KeyedItem[]>;
}

interface KeyedItem {
  /** Text a bare `[[key]]` renders: the item's name as written, minus any legacy comma-note. */
  label: string;
  entry: Entry | null;
  group?: string;
}

/**
 * The key an item answers to in `[[key]]` references: its explicit `key`, else the slug of its
 * name ("Softened Butter (unsalted)" → "softened-butter"). Parentheticals and a legacy
 * comma-note are dropped first, matching how the name is cleaned for prose matching.
 */
export function ingredientKey(item: Pick<StructuredItem, 'name' | 'key'>): string {
  if (item.key) return item.key;
  return item.name
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "crème" → "creme"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  avoidPhrases: string[] = [],
  scale?: ScaleData
): IngredientIndex {
  const forms = new Map<string, FormEntries>();

  const add = (form: string, entry: Entry, specific: boolean) => {
    const key = norm(form);
    if (key.length < 2 || STOP_FORMS.has(key)) return;
    const rec = forms.get(key) ?? { specific: [], generic: [] };
    (specific ? rec.specific : rec.generic).push(entry);
    forms.set(key, rec);
  };

  const keys = new Map<string, KeyedItem[]>();

  for (const g of groups) {
    for (const item of g.items) {
      const us = measurementLabel(item);
      const canonical = cleanName(item.name);
      const entry: Entry | null =
        us && canonical ? { name: canonical, us, grams: gramsOf ? gramsOf(item) : null, group: g.group } : null;
      // An amount scales as a whole or not at all: no grams data for a quantity that can't scale.
      if (entry && scale && isScalable(item.qty)) {
        entry.qty = (item.qty ?? '').trim();
        entry.unit = (item.unit ?? '').trim();
        entry.gramsValue = scale.gramsOf ? scale.gramsOf(item) : null;
      }

      // Every item is referenceable by key, measured or not, so a [[salt]] still resolves.
      const key = ingredientKey(item);
      if (key) {
        const keyed = keys.get(key) ?? [];
        keyed.push({ label: (item.name.split(',')[0] ?? item.name).trim(), entry, group: g.group });
        keys.set(key, keyed);
      }

      if (!entry) continue;
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
    keys,
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

/** Wrap each Unicode fraction glyph ("½") so CSS can draw it in a face where it reads full-size. */
const markFractions = (html: string): string =>
  [...html].map((ch) => (ch in UNICODE_FRACTIONS ? `<span class="ing-frac">${ch}</span>` : ch)).join('');

/**
 * The amount cell for one entry. Carries both US and (when known) grams text; which one
 * shows is driven by the page's `data-units` mode via CSS. A cell with a grams equivalent is
 * marked `.ing-conv` so grams mode can hide only its US text (count/unknown items stay US).
 * An entry built with `ScaleData` also carries its raw values as data attributes.
 */
function amountHtml(e: Entry): string {
  const qtyAttrs =
    e.qty === undefined
      ? ''
      : ` data-qty="${escapeHtml(e.qty)}"${e.unit ? ` data-unit="${escapeHtml(e.unit)}"` : ''}`;
  const gramsAttr = e.gramsValue == null ? '' : ` data-grams="${e.gramsValue}"`;
  const us = `<span class="ing-us"${qtyAttrs}>${markFractions(escapeHtml(e.us))}</span>`;
  const grams = e.grams ? `<span class="ing-grams"${gramsAttr}>${escapeHtml(e.grams)}</span>` : '';
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
  state: LinkState = createLinkState(),
  refs: StepRef[] = []
): string {
  const { regex } = index;
  if (!regex && refs.length === 0) return html;

  const seen = (state.seen ??= new Set<string>());
  state.inlineable ??= 0;

  let skipDepth = 0;
  // Plain text seen so far in this step, used to look behind a match for a stated quantity.
  // Tags and entities collapse to a space: they never carry a quantity themselves, and a
  // space keeps "add <strong>2 cups</strong> flour" readable as one run to the matcher.
  let carry = '';

  /** Lexical linking of one plain-text run; `before` is the step's text up to the run. */
  const linkText = (text: string, before: string): string => {
    if (!regex) return text;
    // Spans of this run covered by an avoid phrase (a tool name); a mention starting inside
    // one is a coincidence of wording, not a real use of the ingredient.
    const avoided: Array<[number, number]> = [];
    if (index.avoid) {
      index.avoid.lastIndex = 0;
      for (let m = index.avoid.exec(text); m !== null; m = index.avoid.exec(text)) {
        avoided.push([m.index, m.index + m[0].length]);
      }
    }

    return text.replace(regex, (match: string, _form: string, offset: number) => {
      const entries = resolve(index, match);
      if (entries.length === 0) return match;

      const inline =
        entries.length === 1 &&
        candidateCount(index, match) === 1 &&
        !avoided.some(([a, b]) => offset >= a && offset < b) &&
        !VERB_USE.test(text.slice(offset + match.length)) &&
        !PRECEDING_QTY.test(before + text.slice(0, offset)) &&
        !seen.has(entryKey(entries[0]));
      if (inline) {
        seen.add(entryKey(entries[0]));
        state.inlineable = (state.inlineable ?? 0) + 1;
      }
      return buildTrigger(match, entries, state.n++, inline);
    });
  };

  /**
   * One explicit `[[key]]` reference. It resolves to exactly the keyed item, so the lexical
   * guards (ambiguity, verb use, tool names) don't apply; only the stated-quantity guard does,
   * because "add 1 cup [[flour]]" would otherwise read "add 1 cup 1 cup flour" in amounts mode.
   */
  const linkRef = (ref: StepRef, keyed: KeyedItem, before: string): string => {
    const label = ref.label ?? keyed.label;
    if (!keyed.entry) return `<span class="ing-plain">${escapeHtml(label)}</span>`;
    const entry = keyed.entry;
    const inline = !PRECEDING_QTY.test(before) && !seen.has(entryKey(entry));
    if (inline) {
      seen.add(entryKey(entry));
      state.inlineable = (state.inlineable ?? 0) + 1;
    }
    return buildTrigger(label, [entry], state.n++, inline);
  };

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

      // Text run: alternate plain text and `[[key]]` placeholders (odd parts are ref indexes).
      const parts = token.split(REF_PLACEHOLDER);
      let out = '';
      for (let i = 0; i < parts.length; i++) {
        const before = carry;
        if (i % 2 === 1) {
          const ref = refs[Number(parts[i])];
          const keyed = lookupRef(index, ref);
          carry += ref.label ?? keyed.label;
          // Inside <a>/<code>: validated above, but rendered as plain text — no nested button.
          out += skipDepth > 0 ? escapeHtml(ref.label ?? keyed.label) : linkRef(ref, keyed, before);
        } else {
          carry += parts[i];
          out += skipDepth > 0 ? parts[i] : linkText(parts[i], before);
        }
      }
      return out;
    })
    .join('');
}

/** One `[[key]]` or `[[key|label]]` reference pulled out of a step before markdown runs. */
export interface StepRef {
  key: string;
  label?: string;
}

/** `[[key]]` / `[[key|display text]]`. The key part excludes `|` and `]`. */
const REF_SYNTAX = /\[\[\s*([^\]|]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]\]/g;

// Private-use code points: markdown passes them through untouched and no real step text uses
// them, so a reference survives inlineMarkdown as an opaque token instead of being escaped.
const REF_OPEN = '';
const REF_CLOSE = '';
const REF_PLACEHOLDER = new RegExp(`${REF_OPEN}(\\d+)${REF_CLOSE}`);

/**
 * Resolve a reference against the recipe's keys, or fail the build with a message that says
 * how to fix it. A typo'd key must not quietly render as nothing.
 */
function lookupRef(index: IngredientIndex, ref: StepRef): KeyedItem {
  const candidates = index.keys.get(ref.key);
  if (!candidates) {
    const known = [...index.keys.keys()].sort().join(', ') || '(none)';
    throw new Error(`[recipe-engine] Unknown ingredient reference [[${ref.key}]]. Keys in this recipe: ${known}.`);
  }
  if (candidates.length > 1) {
    const where = candidates.map((c) => c.group ?? 'ungrouped').join(', ');
    throw new Error(
      `[recipe-engine] [[${ref.key}]] matches ${candidates.length} ingredients (${where}). ` +
        'Give one of them a distinct `key:` and reference that.'
    );
  }
  return candidates[0];
}

/**
 * Render one step: its inline markdown, with every ingredient linked — `[[key]]` references
 * explicitly, the rest of the prose lexically. `state` threads through all steps of a recipe in
 * render order (see createLinkState).
 */
export function linkStep(step: string, index: IngredientIndex, state: LinkState = createLinkState()): string {
  const refs: StepRef[] = [];
  const text = step.replace(REF_SYNTAX, (_match: string, key: string, label?: string) => {
    refs.push({ key, label: label || undefined });
    return `${REF_OPEN}${refs.length - 1}${REF_CLOSE}`;
  });
  return linkIngredientsInHtml(inlineMarkdown(text), index, state, refs);
}
