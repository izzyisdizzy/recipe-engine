import { describe, it, expect } from 'vitest';
import {
  buildIngredientIndex,
  createLinkState,
  linkIngredientsInHtml,
  type IngredientGroup,
} from './ingredients';

// The legacy comma-in-name shape of chocochip-cookies.md (single unnamed group). The recipe
// itself now uses name + detail; this fixture keeps the old shape on purpose as the control arm
// of the parity tests at the bottom of this file — do not migrate it.
const cookies: IngredientGroup[] = [
  {
    items: [
      { name: 'Oil spray' },
      { name: 'butter, softened', qty: '½', unit: 'cup' },
      { name: 'brown sugar', qty: '½', unit: 'cup' },
      { name: 'white sugar', qty: '6', unit: 'tbsp' },
      { name: 'vanilla extract', qty: '1', unit: 'tsp' },
      { name: 'egg', qty: '1' },
      { name: 'flour', qty: '1 ½', unit: 'cup' },
      { name: 'chocolate chips', qty: '6', unit: 'oz' },
    ],
  },
];

// Mirrors apple-bread.md (grouped, duplicate names across groups + prep-prefixed names).
const appleBread: IngredientGroup[] = [
  {
    group: 'Bread layer',
    items: [
      { name: 'softened butter', qty: '8', unit: 'tbsp' },
      { name: 'sugar', qty: '⅔', unit: 'cup' },
      { name: 'eggs', qty: '2' },
      { name: 'vanilla extract', qty: '1 ½', unit: 'tsp' },
      { name: 'oat milk', qty: '½', unit: 'cup' },
    ],
  },
  {
    group: 'Apple layer',
    items: [
      { name: 'brown sugar', qty: '½', unit: 'cup' },
      { name: 'ground cinnamon', qty: '2', unit: 'tsp' },
      { name: 'medium apples', qty: '2' },
    ],
  },
  {
    group: 'Icing',
    items: [
      { name: 'oat milk', qty: '2', unit: 'tbsp' },
      { name: 'vanilla extract', qty: '½', unit: 'tsp' },
    ],
  },
];

// The legacy comma-in-name shape of earl-grey-pound-cake.md — heavily qualified names, short
// prose references. Kept unmigrated as the parity control; see the note on `cookies` above.
const earlGrey: IngredientGroup[] = [
  {
    group: 'Wet Ingredients',
    items: [
      { name: 'unsalted butter, room temp', qty: '1', unit: 'cup' },
      { name: 'vegetable oil', qty: '1/4', unit: 'cup' },
      { name: 'granulated sugar', qty: '1 3/4', unit: 'cup' },
      { name: 'Greek yogurt, room temp', qty: '1/2', unit: 'cup' },
      { name: 'vanilla bean paste', qty: '1', unit: 'tsp' },
      { name: 'lavender paste (or extract)', qty: '1', unit: 'tsp' },
    ],
  },
  {
    group: 'Buttercream Ingredients',
    items: [
      { name: 'unsalted butter, softened', qty: '3/4', unit: 'cup' },
      { name: 'powdered sugar', qty: '2', unit: 'cup' },
      { name: 'vanilla bean paste', qty: '1 1/2', unit: 'tsp' },
      { name: 'lavender extract', qty: '1/2', unit: 'tsp' },
    ],
  },
];

/** Render a step and strip it back to "label→popover-text" pairs for easy assertions. */
function linked(step: string, groups: IngredientGroup[]): Array<[string, string]> {
  const html = linkIngredientsInHtml(step, buildIngredientIndex(groups), { n: 0 });
  const out: Array<[string, string]> = [];
  const re = /<button[^>]*>([^<]*)<\/button><span[^>]*class="ing-pop"[^>]*>(.*?)<\/span><\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push([m[1], m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()]);
  }
  return out;
}

/** Full rendered HTML for a step. */
function render(step: string, groups: IngredientGroup[]): string {
  return linkIngredientsInHtml(step, buildIngredientIndex(groups), { n: 0 });
}

/** How many ingredient triggers a step produced. */
function triggerCount(html: string): number {
  return (html.match(/class="ing-ref[ "]/g) ?? []).length;
}

describe('measurement resolution', () => {
  it('resolves a plain single-word name', () => {
    expect(linked('mix the flour well', cookies)).toEqual([['flour', '1 ½ cup']]);
  });

  it('keeps a count-only measurement (no unit)', () => {
    expect(linked('add the egg', cookies)).toEqual([['egg', '1']]);
  });

  it('excludes items with no measurement', () => {
    expect(linked('spray the pan with oil spray', cookies)).toEqual([]);
  });
});

describe('longest-match & specificity', () => {
  it('prefers the longest name (brown sugar, not sugar)', () => {
    expect(linked('add brown sugar and white sugar', cookies)).toEqual([
      ['brown sugar', '½ cup'],
      ['white sugar', '6 tbsp'],
    ]);
  });

  it('a real "sugar" ingredient wins over another name\'s generic alias', () => {
    // apple-bread has a standalone "sugar"; "brown sugar" also aliases to "sugar" generically,
    // but the specific full-name match must win, so plain "sugar" resolves to just ⅔ cup.
    expect(linked('cream the butter and sugar', appleBread)).toEqual([
      ['butter', '8 tbsp'],
      ['sugar', '⅔ cup'],
    ]);
  });
});

describe('qualified names ↔ short prose (earl grey)', () => {
  it('matches a head noun through a type qualifier (vegetable oil → oil)', () => {
    expect(linked('beat in the oil', earlGrey)).toEqual([['oil', '1/4 cup']]);
  });

  it('matches through a trailing descriptor (vanilla bean paste → vanilla)', () => {
    // vanilla bean paste appears in both groups → both measurements, with group labels.
    const html = render('mix in the vanilla', earlGrey);
    expect(triggerCount(html)).toBe(1);
    expect(html).toContain('1 tsp');
    expect(html).toContain('Wet Ingredients');
    expect(html).toContain('1 1/2 tsp');
    expect(html).toContain('Buttercream Ingredients');
  });

  it('collapses lavender paste / extract to one "lavender" mention with both amounts', () => {
    const html = render('add the lavender', earlGrey);
    expect(triggerCount(html)).toBe(1);
    expect(html).toContain('1 tsp');
    expect(html).toContain('1/2 tsp');
  });

  it('resolves a bare "sugar" to every sugar when there is no plain one', () => {
    const html = render('add the sugar', earlGrey);
    expect(html).toContain('1 3/4 cup'); // granulated
    expect(html).toContain('2 cup'); // powdered
  });

  it('still prefers the specific "powdered sugar" over the shared "sugar" alias', () => {
    expect(linked('add the powdered sugar', earlGrey)).toEqual([['powdered sugar', '2 cup']]);
  });

  it('matches "butter" for both unsalted butters', () => {
    const html = render('beat the butter', earlGrey);
    expect(html).toContain('1 cup');
    expect(html).toContain('3/4 cup');
  });
});

describe('number agreement & boundaries', () => {
  it('matches a leading prep adjective via head noun (medium apples → apples)', () => {
    expect(linked('peel the apples', appleBread)).toEqual([['apples', '2']]);
  });

  it('matches a prose singular against a plural-stored name (apple → apples)', () => {
    expect(linked('chop one apple', appleBread)).toEqual([['apple', '2']]);
  });

  it('is case-insensitive', () => {
    expect(linked('Add the Flour', cookies)).toEqual([['Flour', '1 ½ cup']]);
  });

  it('respects word boundaries (no match inside "salted")', () => {
    const salt: IngredientGroup[] = [{ items: [{ name: 'salt', qty: '½', unit: 'tsp' }] }];
    expect(linked('use salted butter', salt)).toEqual([]);
  });

  it('wraps every occurrence with a unique id', () => {
    const html = linkIngredientsInHtml('flour, then more flour', buildIngredientIndex(cookies), { n: 0 });
    expect(html).toContain('id="ing-pop-0"');
    expect(html).toContain('id="ing-pop-1"');
  });
});

describe('grams rendering', () => {
  // Stub gramsOf: grams only for cup measurements, to mirror the real convertible/not split.
  const gramsOf = (item: { qty?: string; unit?: string }) =>
    item.unit === 'cup' ? '227 g' : null;

  it('bakes both US and grams into a convertible amount, marked convertible', () => {
    const idx = buildIngredientIndex(cookies, gramsOf);
    const html = linkIngredientsInHtml('mix the flour', idx, { n: 0 });
    expect(html).toContain('<span class="ing-amt ing-conv">');
    expect(html).toContain('<span class="ing-us">1 ½ cup</span>');
    expect(html).toContain('<span class="ing-grams">227 g</span>');
  });

  it('omits grams (and the convertible flag) for a count-only amount', () => {
    const idx = buildIngredientIndex(cookies, gramsOf);
    const html = linkIngredientsInHtml('add the egg', idx, { n: 0 });
    expect(html).toContain('<span class="ing-amt">'); // not ing-conv
    expect(html).not.toContain('ing-grams');
  });
});

describe('HTML safety', () => {
  const idx = () => buildIngredientIndex(cookies);

  it('leaves markdown tags intact and still matches text inside them', () => {
    const html = linkIngredientsInHtml('mix the <strong>flour</strong>', idx(), { n: 0 });
    expect(html).toContain('<strong>');
    expect(html).toContain('</strong>');
    expect(html).toMatch(/class="ing-ref[ "]/);
  });

  it('does not wrap text inside a link', () => {
    const html = linkIngredientsInHtml('<a href="/x">flour</a>', idx(), { n: 0 });
    expect(html).toBe('<a href="/x">flour</a>');
  });

  it('does not wrap text inside code', () => {
    const html = linkIngredientsInHtml('<code>flour</code>', idx(), { n: 0 });
    expect(html).toBe('<code>flour</code>');
  });

  it('leaves entities untouched', () => {
    const html = linkIngredientsInHtml('350&deg; then flour', idx(), { n: 0 });
    expect(html).toContain('350&deg;');
    expect(html).toMatch(/class="ing-ref[ "]/);
  });

  it('returns the html unchanged when nothing is indexable', () => {
    const empty = buildIngredientIndex([{ items: [{ name: 'Oil spray' }] }]);
    expect(linkIngredientsInHtml('spray the pan', empty)).toBe('spray the pan');
  });
});

// The `detail` field exists so a prep note can live outside `name`. Both spellings must behave
// identically here, because `cleanName` already truncates a name at its first comma — that is
// what makes migrating "butter, softened" to name + detail a no-op for popovers. Legacy
// comma-in-name recipes are still schema-valid, so both shapes have to keep working.
describe('detail field and legacy comma-in-name parity', () => {
  const cookiesWithDetail: IngredientGroup[] = [
    {
      items: [
        { name: 'Oil spray' },
        { name: 'butter', qty: '½', unit: 'cup', detail: 'softened' },
        { name: 'brown sugar', qty: '½', unit: 'cup' },
        { name: 'white sugar', qty: '6', unit: 'tbsp' },
        { name: 'vanilla extract', qty: '1', unit: 'tsp' },
        { name: 'egg', qty: '1' },
        { name: 'flour', qty: '1 ½', unit: 'cup' },
        { name: 'chocolate chips', qty: '6', unit: 'oz' },
      ],
    },
  ];

  const earlGreyWithDetail: IngredientGroup[] = [
    {
      group: 'Wet Ingredients',
      items: [
        { name: 'unsalted butter', qty: '1', unit: 'cup', detail: 'room temp' },
        { name: 'vegetable oil', qty: '1/4', unit: 'cup' },
        { name: 'granulated sugar', qty: '1 3/4', unit: 'cup' },
        { name: 'Greek yogurt', qty: '1/2', unit: 'cup', detail: 'room temp' },
        { name: 'vanilla bean paste', qty: '1', unit: 'tsp' },
        { name: 'lavender paste (or extract)', qty: '1', unit: 'tsp' },
      ],
    },
    {
      group: 'Buttercream Ingredients',
      items: [
        { name: 'unsalted butter', qty: '3/4', unit: 'cup', detail: 'softened' },
        { name: 'powdered sugar', qty: '2', unit: 'cup' },
        { name: 'vanilla bean paste', qty: '1 1/2', unit: 'tsp' },
        { name: 'lavender extract', qty: '1/2', unit: 'tsp' },
      ],
    },
  ];

  const steps = [
    'cream the butter and sugar until light',
    'beat in the egg, then fold in the flour',
    'whisk the Greek yogurt into the batter',
    'spread the buttercream over the cooled cake',
  ];

  it.each(steps)('renders identically for both shapes: %s', (step) => {
    expect(render(step, cookiesWithDetail)).toBe(render(step, cookies));
    expect(render(step, earlGreyWithDetail)).toBe(render(step, earlGrey));
  });

  it('keeps the detail out of the popover, showing amounts only', () => {
    const step = 'cream the butter and sugar';
    const pairs = linked(step, cookiesWithDetail);
    expect(pairs).toEqual(linked(step, cookies));
    expect(JSON.stringify(pairs)).not.toContain('softened');
  });

  it('indexes two items that differ only by their detail', () => {
    const step = 'cream the butter, then beat the buttercream';
    const pairs = linked(step, earlGreyWithDetail);
    expect(pairs).toEqual(linked(step, earlGrey));
    expect(JSON.stringify(pairs)).not.toContain('room temp');
  });
});

describe('inline amounts', () => {
  // Grams only for cup measurements, mirroring the real convertible/not split.
  const gramsOf = (item: { qty?: string; unit?: string }) => (item.unit === 'cup' ? '227 g' : null);

  it('emits a name-free amount copy before the trigger for a single measurement', () => {
    const html = render('mix in the butter', cookies);
    expect(html).toContain('class="ing-ref ing-has-amt"');
    expect(html).toContain(
      '<span class="ing-inline" aria-hidden="true"><span class="ing-amt"><span class="ing-us">½ cup</span></span> </span><button'
    );
  });

  it('carries both units in the inline copy when convertible', () => {
    const html = linkIngredientsInHtml('mix the flour', buildIngredientIndex(cookies, gramsOf), createLinkState());
    expect(html).toContain(
      '<span class="ing-inline" aria-hidden="true"><span class="ing-amt ing-conv"><span class="ing-us">1 ½ cup</span><span class="ing-grams">227 g</span></span> </span>'
    );
  });

  it('never inlines a multi-measurement mention, and leaves its popover intact', () => {
    const html = render('mix in the vanilla', earlGrey);
    expect(html).not.toContain('ing-inline');
    expect(html).not.toContain('ing-has-amt');
    expect(triggerCount(html)).toBe(1);
  });

  it('inlines only the first mention of an ingredient, across separate steps', () => {
    const idx = buildIngredientIndex(cookies);
    const state = createLinkState();
    const first = linkIngredientsInHtml('cream the butter', idx, state);
    const later = linkIngredientsInHtml('fold the butter back in', idx, state);
    expect(first).toContain('ing-inline');
    expect(later).not.toContain('ing-inline');
    expect(later).toContain('class="ing-ref"'); // still a popover trigger
  });

  it('counts only the mentions that actually inlined', () => {
    const state = createLinkState();
    linkIngredientsInHtml('cream the butter, then add the butter', buildIngredientIndex(cookies), state);
    expect(state.inlineable).toBe(1);
  });

  it('reports nothing inlineable when every mention is ambiguous', () => {
    const state = createLinkState();
    linkIngredientsInHtml('mix in the vanilla', buildIngredientIndex(earlGrey), state);
    expect(state.inlineable).toBe(0);
  });

  it('threads popover ids and the first-mention set through one shared state', () => {
    const idx = buildIngredientIndex(cookies);
    const state = createLinkState();
    const a = linkIngredientsInHtml('cream the butter', idx, state);
    const b = linkIngredientsInHtml('melt the butter', idx, state);
    expect(a).toContain('id="ing-pop-0"');
    expect(b).toContain('id="ing-pop-1"');
    expect(state.inlineable).toBe(1);
  });
});

describe('preceding-quantity guard', () => {
  /** The mention is still linked, it just doesn't take an inline amount. */
  const guarded = (step: string, groups: IngredientGroup[]) => {
    const html = render(step, groups);
    expect(html).toContain('class="ing-ref"');
    expect(html).not.toContain('ing-inline');
  };

  it('skips a stated quantity with a unit', () => guarded('add 1 cup of the flour', cookies));
  it('skips a bare count', () => guarded('beat in 2 eggs', appleBread));
  it('skips a unicode fraction', () => guarded('use ½ cup butter', cookies));
  it('skips a range', () => guarded('core 6-8 apples', appleBread));
  it('skips a mixed number', () => guarded('add 1 1/2 cup flour', cookies));
  it('skips a spelled-out number', () => guarded('chop one apple', appleBread));
  it('skips a word number through prep filler', () => guarded('place half the chopped apples on top', appleBread));
  it('skips an abbreviated unit with a period', () => guarded('stir in 1 tbsp. of the flour', cookies));
  it('skips a unit with no space', () => guarded('pour in 2tbsp oat milk', appleBread));
  it('sees a quantity through inline markup tags', () => guarded('add <strong>2 cups</strong> flour', cookies));

  it('does not suppress when the number belongs to something else', () => {
    expect(render('bake 50 minutes, then fold in the flour', cookies)).toContain('ing-inline');
    expect(render('Step 2. Add flour', cookies)).toContain('ing-inline');
  });

  it('a guarded mention does not consume the first-mention slot', () => {
    const idx = buildIngredientIndex(cookies);
    const state = createLinkState();
    const a = linkIngredientsInHtml('add 1 cup of the flour', idx, state);
    const b = linkIngredientsInHtml('sift the flour', idx, state);
    expect(a).not.toContain('ing-inline');
    expect(b).toContain('ing-inline');
    expect(state.inlineable).toBe(1);
  });
});

describe('tool-name avoidance', () => {
  const tools = ['Mixing bowl', 'Egg beater', 'Baking sheet x2'];

  it('does not inline an ingredient word that is part of a tool name', () => {
    const idx = buildIngredientIndex(cookies, undefined, tools);
    const html = linkIngredientsInHtml('mix together with egg beater', idx, createLinkState());
    expect(html).not.toContain('ing-inline');
  });

  it('leaves the tool mention linked, exactly as before', () => {
    const idx = buildIngredientIndex(cookies, undefined, tools);
    const html = linkIngredientsInHtml('mix together with egg beater', idx, createLinkState());
    expect(html).toContain('class="ing-ref"');
  });

  it('does not let a tool mention consume the first-mention slot', () => {
    const idx = buildIngredientIndex(cookies, undefined, tools);
    const state = createLinkState();
    const html = linkIngredientsInHtml('beat with the egg beater, then add the egg', idx, state);
    // Exactly one inline copy, and it belongs to the real mention at the end.
    expect(html.match(/ing-inline/g)?.length).toBe(1);
    expect(html.indexOf('ing-inline')).toBeGreaterThan(html.indexOf('beater'));
    expect(state.inlineable).toBe(1);
  });

  it('still inlines the same ingredient elsewhere in the step', () => {
    const idx = buildIngredientIndex(cookies, undefined, tools);
    const html = linkIngredientsInHtml('add the egg using an egg beater', idx, createLinkState());
    expect(html.match(/ing-inline/g)?.length).toBe(1);
  });

  it('is a no-op when the recipe lists no tools', () => {
    const idx = buildIngredientIndex(cookies);
    expect(idx.avoid).toBeNull();
    expect(linkIngredientsInHtml('mix with egg beater', idx, createLinkState())).toContain('ing-inline');
  });
});

describe('ambiguity guard', () => {
  // Mirrors lemon-blueberry-coffee-cake.md: a qualified flour in one group and a plain
  // flour in another. A bare "flour" resolves specifically to the ¼ cup one, so inlining
  // would assert the streusel's amount inside the cake batter's step.
  const twoFlours: IngredientGroup[] = [
    { group: 'Cake', items: [{ name: 'cake flour', qty: '2', unit: 'cup' }] },
    { group: 'Streusel', items: [{ name: 'flour', qty: '¼', unit: 'cup' }] },
  ];

  it('does not inline a form that could mean more than one ingredient', () => {
    const html = render('Combine flour, baking powder, and salt', twoFlours);
    expect(html).not.toContain('ing-inline');
  });

  it('still links it, so the popover keeps showing the resolved amount', () => {
    const html = render('Combine flour and salt', twoFlours);
    expect(html).toContain('class="ing-ref"');
    expect(html).toContain('¼ cup');
  });

  it('leaves the ambiguous mention\'s slot open for the qualified one', () => {
    const idx = buildIngredientIndex(twoFlours);
    const state = createLinkState();
    linkIngredientsInHtml('Combine flour and salt', idx, state);
    const later = linkIngredientsInHtml('fold in the cake flour', idx, state);
    expect(later).toContain('ing-inline');
    expect(later).toContain('2 cup');
  });

  it('counts one ingredient once even when it registers a form by several routes', () => {
    // "all purpose flour" reaches "flour" as a head-noun suffix AND via leading-strip.
    const one: IngredientGroup[] = [{ items: [{ name: 'all purpose flour', qty: '3', unit: 'cup' }] }];
    expect(render('sift the flour', one)).toContain('ing-inline');
  });
});

describe('verb-use guard', () => {
  const oils: IngredientGroup[] = [{ items: [{ name: 'vegetable oil', qty: '3', unit: 'tbsp' }] }];

  it('does not inline an ingredient word used as a verb', () => {
    expect(render('Oil the pan and spread the batter evenly.', oils)).not.toContain('ing-inline');
  });

  it('does not let the verb use consume the first-mention slot', () => {
    const idx = buildIngredientIndex(oils);
    const state = createLinkState();
    const a = linkIngredientsInHtml('Oil the pan.', idx, state);
    const b = linkIngredientsInHtml('Stir in the vegetable oil.', idx, state);
    expect(a).not.toContain('ing-inline');
    expect(b).toContain('ing-inline');
    expect(state.inlineable).toBe(1);
  });

  it('still inlines a mention followed by ordinary prose', () => {
    expect(render('Heat the oil in a pan.', oils)).toContain('ing-inline');
    expect(render('Add the oil and whisk.', oils)).toContain('ing-inline');
    expect(render('Pour in the oil.', oils)).toContain('ing-inline');
  });
});
