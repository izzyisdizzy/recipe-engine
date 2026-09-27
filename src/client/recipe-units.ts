/**
 * Ingredient unit toggle (US ↔ Grams) for recipe pages.
 *
 * Both renderings of the amount — the ingredient list and the measurements baked into the
 * step prose — ship with US *and* grams text in the HTML, so switching is pure CSS: this
 * module only stamps the chosen mode and keeps the buttons in sync. The mode goes on the
 * ingredient list and on <html> (for the step amounts, which live in `set:html` content).
 *
 * The control is rendered more than once per page (Ingredients header, Steps header) but is
 * one control: every instance's buttons are driven from this single apply(). The choice is
 * stored so it carries across recipes.
 *
 * Styling is entirely `aria-pressed`: the markup is a Dizzy segmented control
 * (`.dz-seg` / `.dz-seg__btn[aria-pressed]`), so this module never touches a class.
 */
export const UNITS_KEY = 'izzy-recipe-units';

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
    for (const btn of buttons) btn.setAttribute('aria-pressed', String(btn.dataset.unitsBtn === mode));
  };

  const choose = (mode: string) => {
    apply(mode); // updates every instance, not just the one clicked
    try { localStorage.setItem(UNITS_KEY, mode); } catch { /* non-fatal */ }
  };

  let stored: string | null = null;
  try { stored = localStorage.getItem(UNITS_KEY); } catch { /* private mode — just default */ }
  apply(stored ?? 'us');

  for (const btn of buttons) {
    btn.addEventListener('click', () => choose(btn.dataset.unitsBtn ?? 'us'));
    // Left/Right move to the neighbouring option within the same control and select it, the
    // segmented-control convention (matches Dizzy.segmented's keyboard handling).
    btn.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const group = Array.from(
        btn.closest('[data-units-toggle]')?.querySelectorAll<HTMLButtonElement>('[data-units-btn]') ?? []
      );
      const next = group[(group.indexOf(btn) + step + group.length) % group.length];
      if (!next) return;
      event.preventDefault();
      next.focus();
      choose(next.dataset.unitsBtn ?? 'us');
    });
  }
}
