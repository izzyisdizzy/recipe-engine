// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { initIngredientPopovers } from './ingredient-popover';

/** Build the same trigger markup ingredients.ts injects into step HTML. */
function trigger(id: number, label: string): string {
  return (
    `<span class="ing-ref">` +
    `<button type="button" class="ing-ref-btn" aria-expanded="false" aria-describedby="ing-pop-${id}">${label}</button>` +
    `<span role="tooltip" id="ing-pop-${id}" class="ing-pop">stuff</span>` +
    `</span>`
  );
}

function setup(...labels: string[]) {
  document.body.innerHTML =
    labels.map((l, i) => trigger(i, l)).join(' and ') + '<p id="outside">elsewhere</p>';
  initIngredientPopovers();
  const refs = Array.from(document.querySelectorAll<HTMLElement>('.ing-ref'));
  const btns = refs.map((r) => r.querySelector<HTMLButtonElement>('.ing-ref-btn')!);
  return { refs, btns };
}

const isOpen = (ref: HTMLElement) => ref.hasAttribute('data-open');

describe('initIngredientPopovers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens on click and reflects state in aria-expanded', () => {
    const { refs, btns } = setup('flour');
    expect(isOpen(refs[0])).toBe(false);

    btns[0].click();
    expect(isOpen(refs[0])).toBe(true);
    expect(btns[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('toggles closed on a second click', () => {
    const { refs, btns } = setup('flour');
    btns[0].click();
    btns[0].click();
    expect(isOpen(refs[0])).toBe(false);
    expect(btns[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('opening one popover closes any other', () => {
    const { refs, btns } = setup('flour', 'sugar');
    btns[0].click();
    expect(isOpen(refs[0])).toBe(true);

    btns[1].click();
    expect(isOpen(refs[1])).toBe(true);
    expect(isOpen(refs[0])).toBe(false); // first auto-closed
  });

  it('closes when clicking outside any trigger', () => {
    const { refs, btns } = setup('flour');
    btns[0].click();
    expect(isOpen(refs[0])).toBe(true);

    document.getElementById('outside')!.click();
    expect(isOpen(refs[0])).toBe(false);
  });

  it('Escape closes the open popover and returns focus to its button', () => {
    const { refs, btns } = setup('flour');
    btns[0].click();
    expect(isOpen(refs[0])).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isOpen(refs[0])).toBe(false);
    expect(document.activeElement).toBe(btns[0]);
  });

  it('is a no-op when there are no triggers', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(() => initIngredientPopovers()).not.toThrow();
  });
});

describe('inline-amounts mode', () => {
  /** An inlined mention — its amount is in the prose, so its popover is suppressed. */
  function setupMixed() {
    document.body.innerHTML =
      `<span class="ing-ref ing-has-amt">` +
      `<span class="ing-inline"><span class="ing-amt">½ cup</span> </span>` +
      `<button type="button" class="ing-ref-btn" aria-expanded="false" aria-describedby="ing-pop-0">butter</button>` +
      `<span role="tooltip" id="ing-pop-0" class="ing-pop">½ cup</span>` +
      `</span>` +
      trigger(1, 'vanilla');
    initIngredientPopovers();
    const refs = Array.from(document.querySelectorAll<HTMLElement>('.ing-ref'));
    return {
      inlined: refs[0],
      inlinedBtn: refs[0].querySelector<HTMLButtonElement>('.ing-ref-btn')!,
      plain: refs[1],
      plainBtn: refs[1].querySelector<HTMLButtonElement>('.ing-ref-btn')!,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.amounts;
  });

  it('ignores a tap on an inlined mention while inline mode is on', () => {
    const { inlined, inlinedBtn } = setupMixed();
    document.documentElement.dataset.amounts = 'inline';

    inlinedBtn.click();
    expect(inlined.hasAttribute('data-open')).toBe(false);
    expect(inlinedBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('still toggles a multi-measurement mention in inline mode', () => {
    const { plain, plainBtn } = setupMixed();
    document.documentElement.dataset.amounts = 'inline';

    plainBtn.click();
    expect(plain.hasAttribute('data-open')).toBe(true);
    expect(plainBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('resumes toggling the inlined mention once inline mode is off', () => {
    const { inlined, inlinedBtn } = setupMixed();
    document.documentElement.dataset.amounts = 'inline';
    inlinedBtn.click();
    expect(inlined.hasAttribute('data-open')).toBe(false);

    delete document.documentElement.dataset.amounts;
    inlinedBtn.click();
    expect(inlined.hasAttribute('data-open')).toBe(true);
  });
});
