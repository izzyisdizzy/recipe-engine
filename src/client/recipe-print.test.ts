// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initRecipePrint } from './recipe-print';

describe('initRecipePrint', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button type="button" data-recipe-print hidden>⎙ Print</button>';
  });

  const button = () => document.querySelector<HTMLButtonElement>('[data-recipe-print]')!;

  it('reveals the button the markup ships hidden', () => {
    initRecipePrint(button(), () => {});
    expect(button().hidden).toBe(false);
  });

  it('opens the print dialog on click', () => {
    const print = vi.fn();
    initRecipePrint(button(), print);
    expect(print).not.toHaveBeenCalled();
    button().click();
    expect(print).toHaveBeenCalledTimes(1);
  });

  // happy-dom has no window.print, so the print stub is still injected; only the lookup is default.
  it('finds the button by its data attribute by default', () => {
    const print = vi.fn();
    initRecipePrint(undefined, print);
    button().click();
    expect(button().hidden).toBe(false);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the recipe has no print button', () => {
    document.body.innerHTML = '';
    expect(() => initRecipePrint()).not.toThrow();
  });
});
