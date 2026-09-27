// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initUnitsToggle, UNITS_KEY } from './recipe-units';

/**
 * happy-dom here ships no localStorage (which is exactly the "private mode" path the source
 * guards with try/catch), so tests provide their own in-memory one.
 */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  } as Storage;
}

const throwingStorage = (): Storage =>
  ({
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
    clear() { throw new Error('denied'); },
    key() { throw new Error('denied'); },
    length: 0,
  }) as unknown as Storage;

/** The segmented control, as components/UnitsToggle.astro renders it — note: no id. */
function toggleMarkup(label: string): string {
  return (
    `<div data-units-toggle class="dz-seg" role="group" aria-label="${label}">` +
    `<button type="button" data-units-btn="us" class="dz-seg__btn">US</button>` +
    `<button type="button" data-units-btn="grams" class="dz-seg__btn">Grams</button>` +
    `</div>`
  );
}

function setup({ toggles = 2, list = true } = {}) {
  document.body.innerHTML =
    (list ? '<div id="ingredients-list" data-units="us"></div>' : '') +
    Array.from({ length: toggles }, (_, i) => toggleMarkup(`units ${i}`)).join('');
  initUnitsToggle();
  const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-units-toggle]'));
  return {
    groups,
    us: groups.map((g) => g.querySelector<HTMLButtonElement>('[data-units-btn="us"]')!),
    grams: groups.map((g) => g.querySelector<HTMLButtonElement>('[data-units-btn="grams"]')!),
    list: document.getElementById('ingredients-list'),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.units;
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initUnitsToggle', () => {
  it('defaults to US on both the list and <html>', () => {
    const { list, us } = setup();
    expect(list!.dataset.units).toBe('us');
    expect(document.documentElement.dataset.units).toBe('us');
    expect(us[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps every rendering in sync when either one is clicked', () => {
    const { us, grams, list } = setup();

    grams[1].click(); // click the SECOND instance
    expect(list!.dataset.units).toBe('grams');
    expect(document.documentElement.dataset.units).toBe('grams');
    for (const b of grams) expect(b.getAttribute('aria-pressed')).toBe('true');
    for (const b of us) expect(b.getAttribute('aria-pressed')).toBe('false');

    us[0].click(); // …and back from the FIRST
    expect(list!.dataset.units).toBe('us');
    for (const b of us) expect(b.getAttribute('aria-pressed')).toBe('true');
    for (const b of grams) expect(b.getAttribute('aria-pressed')).toBe('false');
  });

  it('never touches classes — the pressed look is CSS keyed on aria-pressed', () => {
    const { grams, us } = setup();
    grams[0].click();
    for (const b of [...grams, ...us]) expect(b.className).toBe('dz-seg__btn');
  });

  it('moves and selects with the arrow keys, wrapping within one control', () => {
    const { us, grams, list } = setup();
    us[0].focus();
    us[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(grams[0]); // stays inside the first control
    expect(list!.dataset.units).toBe('grams');
    for (const b of grams) expect(b.getAttribute('aria-pressed')).toBe('true'); // both instances follow
    expect(localStorage.getItem(UNITS_KEY)).toBe('grams');

    grams[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(us[0]); // wraps
    expect(list!.dataset.units).toBe('us');
  });

  it('ignores keys other than Left/Right', () => {
    const { us, list } = setup();
    us[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(list!.dataset.units).toBe('us');
  });

  it('reflects the stored mode on load, in both renderings', () => {
    localStorage.setItem(UNITS_KEY, 'grams');
    const { grams, list } = setup();
    expect(list!.dataset.units).toBe('grams');
    for (const b of grams) expect(b.getAttribute('aria-pressed')).toBe('true');
  });

  it('persists the choice', () => {
    const { grams } = setup();
    grams[0].click();
    expect(localStorage.getItem(UNITS_KEY)).toBe('grams');
  });

  it('emits no duplicate ids across the two renderings', () => {
    setup();
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('works with a list and no toggles (nothing convertible)', () => {
    const { list } = setup({ toggles: 0 });
    expect(list!.dataset.units).toBe('us');
    expect(document.documentElement.dataset.units).toBe('us');
  });

  it('works with toggles and no list', () => {
    const { grams } = setup({ list: false });
    expect(() => grams[0].click()).not.toThrow();
    expect(document.documentElement.dataset.units).toBe('grams');
  });

  it('does nothing when the page has neither', () => {
    document.body.innerHTML = '';
    initUnitsToggle();
    expect('units' in document.documentElement.dataset).toBe(false);
  });

  it('survives a localStorage that throws', () => {
    vi.stubGlobal('localStorage', throwingStorage());
    const { grams } = setup();
    expect(() => grams[0].click()).not.toThrow();
    expect(document.documentElement.dataset.units).toBe('grams');
  });
});
