/**
 * Ingredient measurement popovers in recipe steps. The triggers and their measurement
 * panels are baked into the step HTML at build time (see ingredients.ts) and reveal on
 * hover / keyboard focus via pure CSS. This module only adds what CSS can't: tap-to-toggle
 * for touch devices, and dismissal via Escape or an outside click. If it never runs (JS
 * disabled), hover and focus still work.
 */
export function initIngredientPopovers(): void {
  const refs = Array.from(document.querySelectorAll<HTMLElement>('.ing-ref'));
  if (refs.length === 0) return;

  const closeAll = (except?: HTMLElement) => {
    for (const ref of refs) {
      if (ref === except) continue;
      if (ref.hasAttribute('data-open')) {
        ref.removeAttribute('data-open');
        ref.querySelector('.ing-ref-btn')?.setAttribute('aria-expanded', 'false');
      }
    }
  };

  for (const ref of refs) {
    const btn = ref.querySelector<HTMLButtonElement>('.ing-ref-btn');
    if (!btn) continue;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // An inlined mention shows its amount in the prose and its popover is CSS-hidden, so a
      // tap must do nothing rather than flip aria-expanded to a lie. Read the mode live: it
      // can change after this listener is attached.
      if (document.documentElement.dataset.amounts === 'inline' && ref.classList.contains('ing-has-amt')) return;
      const open = ref.toggleAttribute('data-open');
      btn.setAttribute('aria-expanded', String(open));
      if (open) closeAll(ref);
    });
  }

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('.ing-ref')) closeAll();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = refs.find((ref) => ref.hasAttribute('data-open'));
    if (!open) return;
    closeAll();
    open.querySelector<HTMLButtonElement>('.ing-ref-btn')?.focus();
  });
}
