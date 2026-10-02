// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyScale, initRecipeScale } from './recipe-scale';
import { SCALE_FACTORS } from '../scale';
import { buildIngredientIndex, createLinkState, linkIngredientsInHtml, type IngredientGroup } from '../ingredients';

/** The segmented control, as components/ScaleControl.astro renders it — note: no id. */
function controlMarkup(label: string): string {
  return (
    `<div data-scale-control class="dz-seg rx-scale" role="group" aria-label="${label}">` +
    SCALE_FACTORS.map(
      (f) =>
        `<button type="button" data-scale-btn="${f.id}" class="dz-seg__btn" aria-pressed="${f.id === '1'}">${f.label}</button>`
    ).join('') +
    `</div>`
  );
}

const groups: IngredientGroup[] = [
  {
    items: [
      { name: 'flour', qty: '1 ½', unit: 'cup' },
      { name: 'egg', qty: '1' },
      { name: 'apples', qty: '6-8' },
    ],
  },
];

/** A page the way components/Recipe.astro bakes it: meta, list, status line and linked steps. */
function setup({ controls = 1 } = {}) {
  const index = buildIngredientIndex(
    groups,
    (item) => (item.unit === 'cup' ? '227 g' : null),
    [],
    { gramsOf: (item) => (item.unit === 'cup' ? 226.8 : null) }
  );
  const step = linkIngredientsInHtml('Mix the flour, then the egg.', index, createLinkState());

  document.body.innerHTML =
    `<dl><dd data-servings="4">4</dd><dd id="yield">8 scones</dd></dl>` +
    Array.from({ length: controls }, (_, i) => controlMarkup(`scale ${i}`)).join('') +
    `<p data-scale-status role="status"></p>` +
    `<div id="ingredients-list" data-units="us"><ul>` +
    `<li><span class="rx-amt ing-us" data-qty="1 ½" data-unit="cup">1 ½ cup</span>` +
    `<span class="rx-amt ing-grams" data-grams="226.8">227 g</span></li>` +
    `<li><span class="rx-amt ing-us" data-qty="6-8">6-8</span></li>` +
    `<li><span class="rx-amt ing-us" id="unscalable">a pinch</span></li>` +
    `</ul></div>` +
    `<p id="step">${step}</p>`;

  initRecipeScale();
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-scale-control]'));
  const button = (id: string, control = 0) =>
    all[control].querySelector<HTMLButtonElement>(`[data-scale-btn="${id}"]`)!;
  return {
    button,
    list: document.getElementById('ingredients-list')!,
    step: document.getElementById('step')!,
    status: document.querySelector<HTMLElement>('[data-scale-status]')!,
    servings: document.querySelector<HTMLElement>('[data-servings]')!,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.scale;
  delete document.documentElement.dataset.units;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initRecipeScale', () => {
  it('starts at 1× and leaves the baked page alone', () => {
    const before = (() => {
      const { list, step } = setup();
      return list.innerHTML + step.innerHTML;
    })();
    const { button, list, step, status } = setup();
    expect(button('1').getAttribute('aria-pressed')).toBe('true');
    expect('scale' in document.documentElement.dataset).toBe(false);
    expect(status.textContent).toBe('');
    expect(list.innerHTML + step.innerHTML).toBe(before);
  });

  it('rewrites the ingredient list from its data attributes', () => {
    const { button, list } = setup();
    button('2').click();
    const amounts = Array.from(list.querySelectorAll('.ing-us')).map((el) => el.textContent);
    expect(amounts).toEqual(['3 cup', '12-16', 'a pinch']);
  });

  it('scales a range in the list down as well as up', () => {
    const { button, list } = setup();
    button('1/2').click();
    expect(list.querySelector('[data-qty="6-8"]')!.textContent).toBe('3-4');
    expect(list.querySelector('[data-qty="1 ½"]')!.textContent).toBe('¾ cup');
  });

  it('never wraps fraction glyphs in the list, which is baked as plain text', () => {
    const { button, list } = setup();
    button('1/2').click();
    expect(list.querySelector('.ing-frac')).toBeNull();
  });

  it('rewrites the step popover and the inline copy, re-wrapping fraction glyphs', () => {
    const { button, step } = setup();
    button('1/2').click();
    const us = Array.from(step.querySelectorAll('.ing-amt .ing-us[data-unit="cup"]'));
    expect(us.length).toBe(2); // the inline copy and the popover
    for (const el of us) {
      expect(el.innerHTML).toBe('<span class="ing-frac">¾</span> cup');
    }
    // The count-only egg: ½, no unit.
    const egg = step.querySelector('.ing-pop .ing-us:not([data-unit])')!;
    expect(egg.innerHTML).toBe('<span class="ing-frac">½</span>');
  });

  it('scales grams from the unrounded value, in the list and the steps alike', () => {
    const { button, list, step } = setup();
    button('3').click();
    // 226.8 × 3 = 680.4; scaling the rounded "227 g" label would give 681.
    expect(list.querySelector('.ing-grams')!.textContent).toBe('680 g');
    for (const el of step.querySelectorAll('.ing-grams')) expect(el.textContent).toBe('680 g');
  });

  it('scales the servings and leaves the freeform yield alone', () => {
    const { button, servings } = setup();
    button('1/3').click();
    expect(servings.textContent).toBe('1 ⅓');
    button('3').click();
    expect(servings.textContent).toBe('12');
    expect(document.getElementById('yield')!.textContent).toBe('8 scones');
  });

  it('leaves an amount with no data attributes untouched', () => {
    const { button } = setup();
    button('3').click();
    expect(document.getElementById('unscalable')!.textContent).toBe('a pinch');
  });

  it('restores the baked markup byte-for-byte on returning to 1×', () => {
    const { button, list, step, servings } = setup();
    const before = list.innerHTML + step.innerHTML + servings.innerHTML;
    button('1/3').click();
    expect(list.innerHTML + step.innerHTML + servings.innerHTML).not.toBe(before);
    button('1').click();
    expect(list.innerHTML + step.innerHTML + servings.innerHTML).toBe(before);
  });

  it('does not compound: each choice is computed from the authored amount', () => {
    const { button, list } = setup();
    button('2').click();
    button('2').click();
    button('3').click();
    expect(list.querySelector('[data-unit="cup"]')!.textContent).toBe('4 ½ cup');
  });

  it('stamps the scale on <html> and announces it, clearing both at 1×', () => {
    const { button, status } = setup();
    button('1/2').click();
    expect(document.documentElement.dataset.scale).toBe('1/2');
    expect(status.textContent).toBe('Amounts scaled to ½.');
    button('1').click();
    expect('scale' in document.documentElement.dataset).toBe(false);
    expect(status.textContent).toBe('');
  });

  it('keeps every rendering of the control in sync', () => {
    const { button } = setup({ controls: 2 });
    button('2', 1).click(); // click the SECOND instance
    for (const control of [0, 1]) {
      expect(button('2', control).getAttribute('aria-pressed')).toBe('true');
      expect(button('1', control).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('never touches classes — the pressed look is CSS keyed on aria-pressed', () => {
    const { button } = setup();
    button('3').click();
    for (const f of SCALE_FACTORS) expect(button(f.id).className).toBe('dz-seg__btn');
  });

  it('moves and selects with the arrow keys, wrapping within one control', () => {
    const { button, list } = setup();
    button('2').focus();
    button('2').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(button('3'));
    expect(list.querySelector('[data-unit="cup"]')!.textContent).toBe('4 ½ cup');

    button('3').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(button('1/3')); // wraps
    expect(button('1/3').getAttribute('aria-pressed')).toBe('true');

    button('1/3').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(button('3'));
  });

  it('ignores keys other than Left/Right', () => {
    const { button } = setup();
    button('1').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(button('1').getAttribute('aria-pressed')).toBe('true');
    expect('scale' in document.documentElement.dataset).toBe(false);
  });

  it('leaves the units mode and storage alone — the scale is not a saved preference', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem } as unknown as Storage);
    const { button, list } = setup();
    button('2').click();
    expect(setItem).not.toHaveBeenCalled();
    expect(list.dataset.units).toBe('us');
    expect('units' in document.documentElement.dataset).toBe(false);
  });

  it('does nothing on a page with no control', () => {
    document.body.innerHTML = '<span class="rx-amt ing-us" data-qty="2" data-unit="cup">2 cup</span>';
    expect(() => initRecipeScale()).not.toThrow();
    expect(document.body.textContent).toBe('2 cup');
  });
});

describe('applyScale', () => {
  it('falls back to 1× for an unknown factor id', () => {
    document.body.innerHTML = '<span class="rx-amt ing-us" data-qty="2" data-unit="cup">2 cup</span>';
    applyScale('7');
    expect(document.body.textContent).toBe('2 cup');
    expect('scale' in document.documentElement.dataset).toBe(false);
  });

  it('can be scoped to a subtree', () => {
    document.body.innerHTML =
      '<div id="a"><span data-qty="2">2</span></div><div id="b"><span data-qty="2">2</span></div>';
    applyScale('2', document.getElementById('a')!);
    expect(document.getElementById('a')!.textContent).toBe('4');
    expect(document.getElementById('b')!.textContent).toBe('2');
  });
});
