// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import densities from '../seed/densities.json';
import { initIngredientTypeahead } from './ingredient-typeahead';

/**
 * The same ingredient row upload.astro stamps from #tpl-item — trimmed to the parts the
 * typeahead touches, plus the neighbouring fields it must not disturb.
 */
function row(): string {
  return (
    `<div data-unit="item-row">` +
    `<input type="text" data-field="item-qty" />` +
    `<select data-field="item-unit"><option value=""></option><option value="cup">cup</option></select>` +
    `<div data-typeahead>` +
    `<input type="text" data-field="item-name" role="combobox" aria-expanded="false" aria-autocomplete="both" />` +
    `<span data-ta-ghost aria-hidden="true" hidden class="ing-ta-ghost"><span data-ta-typed></span><span data-ta-rest></span></span>` +
    `<ul data-ta-list role="listbox" hidden class="ing-ta-list"></ul>` +
    `</div>` +
    `<input type="text" data-field="item-detail" />` +
    `<button type="button" data-action="remove">✕</button>` +
    `</div>`
  );
}

function setup(rows = 1) {
  document.body.innerHTML =
    `<form id="recipe-form">${Array.from({ length: rows }, row).join('')}</form>` +
    `<template id="tpl-item">${row()}</template>`;
  const form = document.getElementById('recipe-form') as HTMLFormElement;
  initIngredientTypeahead(form, densities);
  return form;
}

const names = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>('[data-field="item-name"]'));
const name = (i = 0): HTMLInputElement => names()[i];
const wrap = (input: HTMLInputElement) => input.closest('[data-typeahead]')!;
const list = (input: HTMLInputElement) => wrap(input).querySelector<HTMLElement>('[data-ta-list]')!;
const options = (input: HTMLInputElement) => Array.from(list(input).querySelectorAll('li'));
const labels = (input: HTMLInputElement) =>
  options(input).map((li) => li.querySelector('span')!.textContent);
const selected = (input: HTMLInputElement) =>
  options(input)
    .filter((li) => li.getAttribute('aria-selected') === 'true')
    .map((li) => li.querySelector('span')!.textContent);
const ghost = (input: HTMLInputElement) => {
  const el = wrap(input).querySelector<HTMLElement>('[data-ta-ghost]')!;
  return {
    hidden: el.hidden,
    typed: el.querySelector('[data-ta-typed]')!.textContent,
    rest: el.querySelector('[data-ta-rest]')!.textContent,
  };
};
const isOpen = (input: HTMLInputElement) => !list(input).hidden;

/** Type into a field the way a keystroke would: set the value, then fire a bubbling 'input'. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(input: HTMLInputElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  return event;
}

describe('opening and matching', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('suggests the known-measurement ingredients for what is typed', () => {
    const input = name(setup() && 0);
    type(input, 'ba');

    expect(isOpen(input)).toBe(true);
    expect(labels(input)).toEqual(['baking powder', 'baking soda']);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(selected(input)).toEqual(['baking powder']);
    expect(input.getAttribute('aria-activedescendant')).toBe(options(input)[0].id);
  });

  it('shows the untyped remainder as ghost text', () => {
    setup();
    const input = name();
    type(input, 'ba');

    expect(ghost(input)).toEqual({ hidden: false, typed: 'ba', rest: 'king powder' });
  });

  it('labels each option with its density', () => {
    setup();
    const input = name();
    type(input, 'gochu');

    expect(options(input)[0].textContent).toContain('300 g/cup');
  });

  it('stays shut below the minimum query length', () => {
    setup();
    const input = name();
    type(input, 'b');

    expect(isOpen(input)).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(ghost(input).hidden).toBe(true);
  });

  it('closes again when the query stops matching', () => {
    setup();
    const input = name();
    type(input, 'ba');
    type(input, 'bqq');

    expect(isOpen(input)).toBe(false);
    expect(ghost(input).hidden).toBe(true);
  });

  it('offers a mid-name match in the list but never as ghost text', () => {
    setup();
    const input = name();
    type(input, 'oco');

    expect(labels(input)).toEqual(['chocolate chips', 'cocoa powder']);
    expect(ghost(input).hidden).toBe(true);
  });

  it('highlights nothing when no suggestion completes what was typed', () => {
    setup();
    const input = name();
    // "flour" is already a whole ingredient; only its qualified variants can match.
    type(input, 'flour');

    expect(labels(input)).toEqual([
      '00 flour',
      'all purpose flour',
      'bread flour',
      'cake flour',
    ]);
    expect(selected(input)).toEqual([]);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(ghost(input).hidden).toBe(true);
  });
});

// The form's own Tab key is how you get from the name field to the detail field, so a name
// that is already complete must survive it untouched. A pre-selected variant would silently
// swap the ingredient — and "sugar" -> "brown sugar" would also change the density the
// recipe page converts by, from 200 to 220 g/cup.
describe('a complete name is never rewritten by tabbing on', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  for (const typed of ['flour', 'sugar', 'milk', 'butter', 'cinnamon']) {
    it(`leaves "${typed}" alone on Tab`, () => {
      setup();
      const input = name();
      type(input, typed);

      expect(isOpen(input)).toBe(true); // the variants are still on offer
      const event = press(input, 'Tab');
      expect(event.defaultPrevented).toBe(false);
      expect(input.value).toBe(typed);
      expect(isOpen(input)).toBe(false);
    });
  }

  it('does not turn "butter" into "buttermilk", though it is a genuine prefix of it', () => {
    setup();
    const input = name();
    type(input, 'butter');

    // The completion is real, which is why the guard can't just be about prefixes: "butter"
    // is an ingredient on its own, so nothing is offered up for a stray Tab to take.
    expect(labels(input)).toEqual(['buttermilk', 'plant butter']);
    expect(selected(input)).toEqual([]);
    expect(ghost(input).hidden).toBe(true);
    expect(press(input, 'Tab').defaultPrevented).toBe(false);
    expect(input.value).toBe('butter');
  });

  it('still completes butter to buttermilk when that is what was asked for', () => {
    setup();
    const input = name();
    type(input, 'butter');
    press(input, 'ArrowDown');

    expect(ghost(input)).toEqual({ hidden: false, typed: 'butter', rest: 'milk' });
    press(input, 'Tab');
    expect(input.value).toBe('buttermilk');
  });

  it('leaves a complete name alone on Enter, which still publishes', () => {
    setup();
    const input = name();
    type(input, 'sugar');

    expect(press(input, 'Enter').defaultPrevented).toBe(false);
    expect(input.value).toBe('sugar');
  });

  it('commits a variant once the arrow keys pick one', () => {
    setup();
    const input = name();
    type(input, 'flour');
    press(input, 'ArrowDown');

    expect(selected(input)).toEqual(['00 flour']);
    expect(press(input, 'Tab').defaultPrevented).toBe(true);
    expect(input.value).toBe('00 flour');
  });

  it('reaches the last variant with ArrowUp from nothing highlighted', () => {
    setup();
    const input = name();
    type(input, 'flour');
    press(input, 'ArrowUp');

    expect(selected(input)).toEqual(['cake flour']);
  });

  it('still commits a click, which is unambiguous', () => {
    setup();
    const input = name();
    type(input, 'flour');
    options(input)[2].dispatchEvent(new Event('click', { bubbles: true }));

    expect(input.value).toBe('bread flour');
  });

  it('holds for every ingredient on file, not just the ones spelled out above', () => {
    // The invariant: a name already in the density list is exactly the name that must survive
    // a Tab, so no future addition to densities.json can reintroduce the swap by being a
    // prefix of another entry. Guards all of them at once.
    const rewritten: string[] = [];
    for (const known of Object.keys(densities)) {
      setup();
      const input = name();
      type(input, known);
      press(input, 'Tab');
      if (input.value !== known) rewritten.push(`${known} -> ${input.value}`);
    }
    expect(rewritten).toEqual([]);
  });
});

describe('accepting', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fills the field on Tab and closes', () => {
    setup();
    const input = name();
    type(input, 'ba');

    const event = press(input, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('baking powder');
    expect(isOpen(input)).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(ghost(input).hidden).toBe(true);
  });

  it('fills the field on Enter', () => {
    setup();
    const input = name();
    type(input, 'ba');

    expect(press(input, 'Enter').defaultPrevented).toBe(true);
    expect(input.value).toBe('baking powder');
  });

  it('accepts the highlighted option, not just the first', () => {
    setup();
    const input = name();
    type(input, 'ba');
    press(input, 'ArrowDown');
    press(input, 'Tab');

    expect(input.value).toBe('baking soda');
  });

  it('fills the field when an option is clicked', () => {
    setup();
    const input = name();
    type(input, 'ba');
    options(input)[1].dispatchEvent(new Event('click', { bubbles: true }));

    expect(input.value).toBe('baking soda');
    expect(isOpen(input)).toBe(false);
  });

  it('keeps focus on the field when an option is pressed', () => {
    setup();
    const input = name();
    type(input, 'ba');
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    options(input)[0].dispatchEvent(event);

    // Without this the field would blur and tear the list down before the click landed.
    expect(event.defaultPrevented).toBe(true);
  });

  it('writes the canonical name, not the typed casing', () => {
    setup();
    const input = name();
    type(input, 'BAking');
    press(input, 'Tab');

    expect(input.value).toBe('baking powder');
  });

  it('hands the uploader exactly one input event and does not reopen on it', () => {
    const form = setup();
    const input = name();
    type(input, 'ba');

    // What the uploader's own delegated listener sees: it drives the grams prompt, the
    // markdown preview and the draft autosave, so an accepted name has to arrive as an event.
    let seen = 0;
    form.addEventListener('input', () => {
      seen += 1;
    });
    press(input, 'Tab');

    expect(seen).toBe(1);
    expect(isOpen(input)).toBe(false);
  });
});

describe('keyboard traversal is left alone', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not touch Tab when nothing is suggested', () => {
    setup();
    const input = name();

    expect(press(input, 'Tab').defaultPrevented).toBe(false);
    type(input, 'b');
    expect(press(input, 'Tab').defaultPrevented).toBe(false);
    expect(input.value).toBe('b');
  });

  it('does not touch Shift+Tab even with the list open', () => {
    setup();
    const input = name();
    type(input, 'ba');

    const event = press(input, 'Tab', { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(input.value).toBe('ba');
    expect(isOpen(input)).toBe(false);
  });

  it('does not touch Enter when the list is closed, so publishing still works', () => {
    setup();
    const input = name();
    type(input, 'b');

    expect(press(input, 'Enter').defaultPrevented).toBe(false);
  });

  it('leaves other fields in the row alone', () => {
    setup();
    const qty = document.querySelector<HTMLInputElement>('[data-field="item-qty"]')!;
    type(qty, 'ba');

    expect(isOpen(name())).toBe(false);
    expect(press(qty, 'Tab').defaultPrevented).toBe(false);
  });
});

describe('navigating', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('moves the highlight and wraps around', () => {
    setup();
    const input = name();
    type(input, 'ba');
    expect(selected(input)).toEqual(['baking powder']);

    press(input, 'ArrowDown');
    expect(selected(input)).toEqual(['baking soda']);
    press(input, 'ArrowDown');
    expect(selected(input)).toEqual(['baking powder']);
    press(input, 'ArrowUp');
    expect(selected(input)).toEqual(['baking soda']);
  });

  it('tracks the highlight in the ghost text', () => {
    setup();
    const input = name();
    type(input, 'ba');
    press(input, 'ArrowDown');

    expect(ghost(input)).toEqual({ hidden: false, typed: 'ba', rest: 'king soda' });
  });

  it('opens a closed list on ArrowDown', () => {
    setup();
    const input = name();
    input.value = 'ba'; // typed before the module was listening
    const event = press(input, 'ArrowDown');

    expect(event.defaultPrevented).toBe(true);
    expect(isOpen(input)).toBe(true);
  });

  it('leaves ArrowUp alone when the list is closed', () => {
    setup();
    const input = name();

    expect(press(input, 'ArrowUp').defaultPrevented).toBe(false);
  });
});

describe('dismissing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('closes on Escape, keeping what was typed', () => {
    setup();
    const input = name();
    type(input, 'ba');

    const event = press(input, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('ba');
    expect(isOpen(input)).toBe(false);
    expect(ghost(input).hidden).toBe(true);
  });

  it('stays shut after Escape until it is asked for again', () => {
    setup();
    const input = name();
    type(input, 'ba');
    press(input, 'Escape');

    // Tab must fall through to normal focus traversal now, not re-accept the dismissed match.
    expect(press(input, 'Tab').defaultPrevented).toBe(false);
    expect(input.value).toBe('ba');
    expect(isOpen(input)).toBe(false);
  });

  it('reopens on the next keystroke after Escape', () => {
    setup();
    const input = name();
    type(input, 'ba');
    press(input, 'Escape');
    type(input, 'bak');

    expect(isOpen(input)).toBe(true);
  });

  it('reopens on ArrowDown after Escape, an explicit request for the list', () => {
    setup();
    const input = name();
    type(input, 'ba');
    press(input, 'Escape');
    press(input, 'ArrowDown');

    expect(isOpen(input)).toBe(true);
    expect(selected(input)).toEqual(['baking powder']);
  });

  it('leaves Escape alone when the list is closed', () => {
    setup();
    const input = name();

    expect(press(input, 'Escape').defaultPrevented).toBe(false);
  });

  it('commits nothing when the field loses focus', () => {
    setup();
    const input = name();
    type(input, 'ba');
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(input.value).toBe('ba');
    expect(isOpen(input)).toBe(false);
    expect(ghost(input).hidden).toBe(true);
  });
});

describe('rows beyond the first', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('works independently in each row', () => {
    setup(2);
    type(name(0), 'ba');
    type(name(1), 'gochu');

    expect(labels(name(0))).toEqual(['baking powder', 'baking soda']);
    expect(labels(name(1))).toEqual(['gochujang']);
  });

  it('gives every row its own listbox to point at', () => {
    setup(2);
    const [a, b] = names();
    type(a, 'ba');
    type(b, 'ba');

    expect(list(a).id).not.toBe(list(b).id);
    expect(a.getAttribute('aria-controls')).toBe(list(a).id);
    expect(b.getAttribute('aria-controls')).toBe(list(b).id);
  });

  it('covers a row added after it started listening', () => {
    const form = setup();
    // What `+ Ingredient` does: clone #tpl-item and append it.
    const tpl = document.getElementById('tpl-item') as HTMLTemplateElement;
    form.appendChild(tpl.content.firstElementChild!.cloneNode(true));

    const added = name(1);
    type(added, 'ba');

    expect(isOpen(added)).toBe(true);
    expect(labels(added)).toEqual(['baking powder', 'baking soda']);
    press(added, 'Tab');
    expect(added.value).toBe('baking powder');
  });
});

describe('composition (IME)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('stays out of the way while text is being composed', () => {
    setup();
    const input = name();
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    type(input, 'ba');

    expect(isOpen(input)).toBe(false);

    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(isOpen(input)).toBe(true);
  });

  it('ignores keys that are part of a composition', () => {
    setup();
    const input = name();
    type(input, 'ba');

    const event = press(input, 'Enter', { isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(input.value).toBe('ba');
  });
});
