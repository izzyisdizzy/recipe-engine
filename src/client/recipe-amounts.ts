/**
 * "Show amounts" mode for recipe steps.
 *
 * Every eligible ingredient mention already carries a hidden copy of its measurement,
 * baked in at build time (see ../ingredients.ts) and revealed by CSS from
 * <html data-amounts="inline">. This module owns the button's state, its persistence, and
 * the accessibility fix-ups CSS can't do.
 *
 * Those fix-ups are the subtle part. In inline mode an inlined mention's popover is
 * `display: none`, which prunes it from the accessibility tree — so `aria-describedby` then
 * describes nothing, and if the inline copy stayed `aria-hidden` the amount would be
 * announced nowhere at all. So the two swap: the popover's semantics come off, the inline
 * copy's `aria-hidden` comes off, and because that copy sits before the name it reads as
 * "½ cup butter". The trigger also stops being a tab stop, since it no longer opens
 * anything. Turning the mode off restores every attribute — nothing needs stashing, as the
 * describedby id is recoverable from the panel's own id.
 */
export const AMOUNTS_KEY = 'izzy-recipe-amounts';


/** Apply (or undo) inline-amounts mode across the page. Idempotent. */
export function applyInlineAmounts(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.amounts = 'inline';
  else delete root.dataset.amounts;

  for (const ref of Array.from(document.querySelectorAll<HTMLElement>('.ing-ref.ing-has-amt'))) {
    const btn = ref.querySelector<HTMLButtonElement>('.ing-ref-btn');
    const pop = ref.querySelector<HTMLElement>('.ing-pop');
    const inline = ref.querySelector<HTMLElement>('.ing-inline');
    if (!btn || !pop) continue;

    if (on) {
      ref.removeAttribute('data-open'); // close anything the tap-toggle left open
      btn.setAttribute('tabindex', '-1');
      btn.removeAttribute('aria-expanded');
      btn.removeAttribute('aria-describedby');
      pop.removeAttribute('role');
      inline?.removeAttribute('aria-hidden');
    } else {
      btn.removeAttribute('tabindex');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-describedby', pop.id);
      pop.setAttribute('role', 'tooltip');
      inline?.setAttribute('aria-hidden', 'true');
    }
  }
}

/** Wire the "Show amounts" / "Hide amounts" button, seeded from the stored preference. */
export function initAmountsToggle(btn: HTMLElement | null = document.getElementById('amounts-toggle')): void {
  if (!btn) return;

  const apply = (on: boolean) => {
    applyInlineAmounts(on);
    btn.textContent = on ? 'Hide amounts' : 'Show amounts';
    btn.setAttribute('aria-pressed', String(on)); // the pressed look is CSS keyed on this
  };

  let stored: string | null = null;
  try { stored = localStorage.getItem(AMOUNTS_KEY); } catch { /* private mode — just default */ }
  apply(stored === 'inline'); // label and pressed state come from storage, never the static markup

  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    apply(on);
    try { localStorage.setItem(AMOUNTS_KEY, on ? 'inline' : 'off'); } catch { /* non-fatal */ }
  });
}
