/**
 * The recipe header's "Print" button.
 *
 * The markup ships it `hidden`, so a visitor without JavaScript never sees a button that does
 * nothing; this reveals it and wires it to the browser's print dialog. What lands on paper is
 * decided by the `@media print` rules in styles/recipes.css (controls hidden, steps kept whole),
 * and it reflects whatever units, scale and inline amounts are showing on screen.
 */

/** Reveal and wire the print button. `print` is injectable for tests. */
export function initRecipePrint(
  btn: HTMLElement | null = document.querySelector<HTMLElement>('[data-recipe-print]'),
  print: () => void = () => window.print()
): void {
  if (!btn) return;
  btn.hidden = false;
  btn.addEventListener('click', () => print());
}
