// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyInlineAmounts, initAmountsToggle, AMOUNTS_KEY } from './recipe-amounts';

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

/** The trigger markup ../ingredients.ts bakes for a mention that carries an inline amount. */
function inlined(id: number, label: string, amount: string): string {
  return (
    `<span class="ing-ref ing-has-amt">` +
    `<span class="ing-inline" aria-hidden="true"><span class="ing-amt"><span class="ing-us">${amount}</span></span> </span>` +
    `<button type="button" class="ing-ref-btn" aria-expanded="false" aria-describedby="ing-pop-${id}">${label}</button>` +
    `<span role="tooltip" id="ing-pop-${id}" class="ing-pop"><span class="ing-amt"><span class="ing-us">${amount}</span></span></span>` +
    `</span>`
  );
}

/** A mention resolving to several measurements — never inlined, untouched in both modes. */
function ambiguous(id: number, label: string): string {
  return (
    `<span class="ing-ref">` +
    `<button type="button" class="ing-ref-btn" aria-expanded="false" aria-describedby="ing-pop-${id}">${label}</button>` +
    `<span role="tooltip" id="ing-pop-${id}" class="ing-pop">rows</span>` +
    `</span>`
  );
}

/**
 * Every attribute of a mention's subtree, order-independent — removing and re-adding an
 * attribute moves it in the serialization, which says nothing about whether state survived.
 */
function snapshot(root: HTMLElement): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const els = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  els.forEach((el, i) => {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
    out[`${i}:${el.tagName}`] = attrs;
  });
  return out;
}

function setup(withButton = true) {
  document.body.innerHTML =
    inlined(0, 'butter', '½ cup') +
    ambiguous(1, 'vanilla') +
    (withButton
      ? '<button type="button" id="amounts-toggle" aria-pressed="false" class="text-neutral-500 dark:text-neutral-400">Show amounts</button>'
      : '');
  return {
    ref: document.querySelector<HTMLElement>('.ing-has-amt')!,
    btn: document.querySelector<HTMLButtonElement>('.ing-has-amt .ing-ref-btn')!,
    pop: document.querySelector<HTMLElement>('.ing-has-amt .ing-pop')!,
    inline: document.querySelector<HTMLElement>('.ing-inline')!,
    plain: document.querySelectorAll<HTMLElement>('.ing-ref')[1],
    toggle: document.getElementById('amounts-toggle')!,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.amounts;
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyInlineAmounts', () => {
  it('stamps the mode on <html> and hands the amount to the inline copy', () => {
    const { btn, pop, inline } = setup();
    applyInlineAmounts(true);

    expect(document.documentElement.dataset.amounts).toBe('inline');
    expect(btn.getAttribute('tabindex')).toBe('-1');
    expect(btn.hasAttribute('aria-describedby')).toBe(false);
    expect(btn.hasAttribute('aria-expanded')).toBe(false);
    expect(pop.hasAttribute('role')).toBe(false);
    expect(inline.hasAttribute('aria-hidden')).toBe(false);
  });

  it('removes the attribute entirely when off, rather than storing a falsy value', () => {
    setup();
    applyInlineAmounts(true);
    applyInlineAmounts(false);
    expect('amounts' in document.documentElement.dataset).toBe(false);
  });

  it('restores every attribute losslessly on the round trip', () => {
    const { ref } = setup();
    const before = snapshot(ref);

    applyInlineAmounts(true);
    expect(snapshot(ref)).not.toEqual(before);

    applyInlineAmounts(false);
    expect(snapshot(ref)).toEqual(before);
  });

  it('closes a popover left open by the tap-toggle', () => {
    const { ref, btn } = setup();
    ref.setAttribute('data-open', '');
    btn.setAttribute('aria-expanded', 'true');

    applyInlineAmounts(true);
    expect(ref.hasAttribute('data-open')).toBe(false);
  });

  it('leaves a multi-measurement mention alone in both modes', () => {
    const { plain } = setup();
    const before = plain.outerHTML;
    applyInlineAmounts(true);
    expect(plain.outerHTML).toBe(before);
    applyInlineAmounts(false);
    expect(plain.outerHTML).toBe(before);
  });

  it('is idempotent', () => {
    const { ref } = setup();
    applyInlineAmounts(true);
    const on = ref.outerHTML;
    applyInlineAmounts(true);
    expect(ref.outerHTML).toBe(on);
  });
});

describe('initAmountsToggle', () => {
  it('swaps the label and pressed state on click', () => {
    const { toggle } = setup();
    initAmountsToggle(toggle);
    expect(toggle.textContent).toBe('Show amounts');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    expect(toggle.textContent).toBe('Hide amounts');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.amounts).toBe('inline');

    toggle.click();
    expect(toggle.textContent).toBe('Show amounts');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect('amounts' in document.documentElement.dataset).toBe(false);
  });

  it('tracks the active classes with the pressed state', () => {
    const { toggle } = setup();
    initAmountsToggle(toggle);
    expect(toggle.classList.contains('text-neutral-500')).toBe(true);

    toggle.click();
    expect(toggle.classList.contains('bg-accent-50')).toBe(true);
    expect(toggle.classList.contains('text-accent-700')).toBe(true);
    expect(toggle.classList.contains('text-neutral-500')).toBe(false);
  });

  it('persists the choice', () => {
    const { toggle } = setup();
    initAmountsToggle(toggle);
    toggle.click();
    expect(localStorage.getItem(AMOUNTS_KEY)).toBe('inline');
    toggle.click();
    expect(localStorage.getItem(AMOUNTS_KEY)).toBe('off');
  });

  it('seeds label, state and mode from storage rather than the static markup', () => {
    localStorage.setItem(AMOUNTS_KEY, 'inline');
    const { toggle, btn } = setup();
    initAmountsToggle(toggle);

    expect(toggle.textContent).toBe('Hide amounts');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.amounts).toBe('inline');
    expect(btn.getAttribute('tabindex')).toBe('-1');
  });

  it('survives a localStorage that throws', () => {
    vi.stubGlobal('localStorage', throwingStorage());
    const { toggle } = setup();
    expect(() => initAmountsToggle(toggle)).not.toThrow();
    expect(() => toggle.click()).not.toThrow();
    expect(document.documentElement.dataset.amounts).toBe('inline');
  });

  it('does nothing when the button is absent', () => {
    setup(false);
    expect(() => initAmountsToggle(null)).not.toThrow();
    expect('amounts' in document.documentElement.dataset).toBe(false);
  });
});
