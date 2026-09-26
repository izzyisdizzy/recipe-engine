/**
 * Ingredient unit toggle (US ↔ Grams) for recipe pages.
 *
 * Both renderings of the amount — the ingredient list and the measurements baked into the
 * step prose — ship with US *and* grams text in the HTML, so switching is pure CSS: this
 * module only stamps the chosen mode and keeps the buttons in sync. The mode goes on the
 * ingredient list (for its component-scoped rules) and on <html> (for the step amounts,
 * which live in `set:html` content that scoped styles can't reach).
 *
 * The control is rendered more than once per page (Ingredients header, Steps header) but is
 * one control: every instance's buttons are driven from this single apply(). The choice is
 * stored so it carries across recipes.
 */
export const UNITS_KEY = 'izzy-recipe-units';

const ACTIVE_CLS = ['bg-accent-50', 'text-accent-700', 'dark:bg-neutral-800', 'dark:text-accent-100'];

export function initUnitsToggle(): void {
  const list = document.getElementById('ingredients-list');
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-units-toggle] [data-units-btn]')
  );
  // A page may have the list with no toggle (nothing convertible) — or, in principle, the
  // reverse. Only bail when there is nothing at all to drive.
  if (!list && buttons.length === 0) return;

  const apply = (units: string) => {
    const mode = units === 'grams' ? 'grams' : 'us';
    if (list) list.dataset.units = mode;
    document.documentElement.dataset.units = mode;
    for (const btn of buttons) {
      const on = btn.dataset.unitsBtn === mode;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('text-neutral-500', !on);
      btn.classList.toggle('dark:text-neutral-400', !on);
      ACTIVE_CLS.forEach((c) => btn.classList.toggle(c, on));
    }
  };

  let stored: string | null = null;
  try { stored = localStorage.getItem(UNITS_KEY); } catch { /* private mode — just default */ }
  apply(stored ?? 'us');

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.unitsBtn ?? 'us';
      apply(mode); // updates every instance, not just the one clicked
      try { localStorage.setItem(UNITS_KEY, mode); } catch { /* non-fatal */ }
    });
  }
}
