/**
 * Ingredient-name autocomplete for a recipe upload form (izzybennett.com's /upload). Suggests
 * the ingredients whose measurements are already on file — the keys of the density table passed
 * to initIngredientTypeahead() — as you type a row's name: the best
 * match appears as grey ghost text after the caret (Tab accepts it) with the rest in a
 * listbox below (arrows + Enter, or a click).
 *
 * One rule ties the keyboard to what's on screen: a highlight, ghost text, and "Tab will
 * commit this" always appear together. Only a match that completes what's typed is offered
 * that way, so a name that's already complete lists its variants without pre-selecting one,
 * and Tab goes on moving to the next field until you pick something with the arrow keys.
 *
 * This lives in its own module rather than in upload.astro's big inline script because that
 * script is a `define:vars` block, which Astro leaves unprocessed — it can't import, which is
 * why it re-implements its unit maths by hand. Nothing here needs to be duplicated there:
 * accepting a suggestion writes the input and re-dispatches 'input', so the uploader's own
 * delegated listener refreshes the grams prompt, the markdown preview and the draft autosave
 * exactly as it would for a keystroke.
 *
 * Every listener is delegated from the form, so rows cloned from <template> later — a new
 * ingredient, a new group, an edited recipe's rehydrated rows — are covered for free.
 */
import { normalizeName, rankIngredientSuggestions, type Suggestion } from './ingredient-suggest';
import type { Densities } from './units';

// The density table the suggestions come from, set by initIngredientTypeahead(). One table per
// page: the uploader has one form and one table, so this stays module state rather than being
// threaded through every helper.
let GRAMS_PER_CUP: Densities = {};
let NAMES: string[] = [];

const NAME_FIELD = '[data-field="item-name"]';
const OPTION_CLASS = 'ing-ta-opt';

interface State {
  /** Minted per input: the markup is cloned, so ids can't be written into the template. */
  listId: string;
  matches: Suggestion[];
  /** Index into `matches`, or -1 when the popup is closed. */
  active: number;
  /**
   * Set by Escape so the popup stays shut instead of springing back. Cleared only by the user
   * asking for it again — a keystroke, or ArrowDown — never by the popup itself.
   */
  dismissed: boolean;
  composing: boolean;
}

interface Parts {
  list: HTMLElement;
  ghost: HTMLElement | null;
  typed: HTMLElement | null;
  rest: HTMLElement | null;
}

const states = new WeakMap<HTMLInputElement, State>();
let nextId = 1;

/**
 * True only while an accepted name is being written back. The uploader's delegated 'input'
 * listener must still see that event, but ours must not, or it would reopen on the value it
 * just committed. This is an explicit flag rather than a check on `event.isTrusted` because
 * every dispatched event is untrusted — including the ones the tests use to type.
 */
let accepting = false;

function partsOf(input: HTMLInputElement): Parts | null {
  const wrap = input.closest<HTMLElement>('[data-typeahead]');
  const list = wrap?.querySelector<HTMLElement>('[data-ta-list]');
  if (!wrap || !list) return null;
  return {
    list,
    ghost: wrap.querySelector<HTMLElement>('[data-ta-ghost]'),
    typed: wrap.querySelector<HTMLElement>('[data-ta-typed]'),
    rest: wrap.querySelector<HTMLElement>('[data-ta-rest]'),
  };
}

function stateOf(input: HTMLInputElement, parts: Parts): State {
  let state = states.get(input);
  if (!state) {
    state = {
      listId: `ing-ta-${nextId++}`,
      matches: [],
      active: -1,
      dismissed: false,
      composing: false,
    };
    parts.list.id = state.listId;
    input.setAttribute('aria-controls', state.listId);
    states.set(input, state);
  }
  return state;
}

const isOpen = (input: HTMLInputElement): boolean => (states.get(input)?.matches.length ?? 0) > 0;

function clearGhost(parts: Parts): void {
  if (!parts.ghost) return;
  parts.ghost.hidden = true;
  if (parts.typed) parts.typed.textContent = '';
  if (parts.rest) parts.rest.textContent = '';
}

function close(input: HTMLInputElement): void {
  const parts = partsOf(input);
  const state = states.get(input);
  if (state) {
    state.matches = [];
    state.active = -1;
  }
  if (!parts) return;
  parts.list.hidden = true;
  parts.list.replaceChildren();
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  clearGhost(parts);
}

/**
 * Draw the inline completion for the active match.
 *
 * Shown only when what's typed is a literal prefix of the canonical name (case aside), so the
 * remainder is exactly the rest of that name and the overlay lines up character for character.
 * A trailing space or a mid-word match has no honest inline form, and neither does a value the
 * input has scrolled — in all of those the listbox carries the suggestion on its own.
 */
function renderGhost(input: HTMLInputElement, parts: Parts, state: State): void {
  const match = state.active >= 0 ? state.matches[state.active] : undefined;
  const value = input.value;
  const alignable =
    !!match &&
    match.isPrefix &&
    !state.composing &&
    value.length > 0 &&
    match.name.startsWith(value.toLowerCase()) &&
    input.scrollLeft === 0 &&
    input.scrollWidth <= input.clientWidth;

  if (!alignable || !parts.ghost || !parts.typed || !parts.rest) {
    clearGhost(parts);
    return;
  }
  parts.typed.textContent = value;
  parts.rest.textContent = match.name.slice(value.length);
  parts.ghost.hidden = false;
}

function renderList(input: HTMLInputElement, parts: Parts, state: State): void {
  parts.list.replaceChildren(
    ...state.matches.map((match, i) => {
      const option = document.createElement('li');
      option.id = `${state.listId}-opt-${i}`;
      option.className = OPTION_CLASS;
      option.dataset.index = String(i);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(i === state.active));

      const name = document.createElement('span');
      name.textContent = match.name;
      option.append(name);

      // The gram figure is the whole point of this list: it's why the ingredient is offered.
      const grams = GRAMS_PER_CUP[match.name];
      if (typeof grams === 'number') {
        const amount = document.createElement('span');
        amount.className = 'ing-ta-grams';
        amount.textContent = `${grams} g/cup`;
        option.append(amount);
      }
      return option;
    })
  );
  parts.list.hidden = state.matches.length === 0;
  input.setAttribute('aria-expanded', String(state.matches.length > 0));
  if (state.active >= 0) {
    input.setAttribute('aria-activedescendant', `${state.listId}-opt-${state.active}`);
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

/** Recompute the suggestions for what's currently in the input. */
function refresh(input: HTMLInputElement): void {
  const parts = partsOf(input);
  if (!parts) return;
  const state = stateOf(input, parts);
  if (state.dismissed || state.composing) {
    close(input);
    return;
  }
  state.matches = rankIngredientSuggestions(input.value, NAMES);
  if (state.matches.length === 0) {
    close(input);
    return;
  }
  // Highlight the top match only when it completes what's typed AND what's typed isn't already
  // an ingredient in its own right, so that a highlight, ghost text, and "Tab will commit this"
  // always mean the same thing. Both halves matter: "flour" matches only its qualified variants
  // ("cake flour"), while "butter" is a genuine prefix of "buttermilk" — pre-selecting either
  // would let a Tab meant for the detail field swap the ingredient, and with it the density the
  // recipe page converts by. The variants stay listed; they just have to be chosen.
  const typedIsIngredient = normalizeName(input.value) in GRAMS_PER_CUP;
  state.active = !typedIsIngredient && state.matches[0].isPrefix ? 0 : -1;
  renderList(input, parts, state);
  renderGhost(input, parts, state);
}

function move(input: HTMLInputElement, delta: number): void {
  const parts = partsOf(input);
  const state = states.get(input);
  if (!parts || !state || state.matches.length === 0) return;
  const count = state.matches.length;
  // From "nothing highlighted", down lands on the first entry and up on the last.
  state.active =
    state.active < 0 ? (delta > 0 ? 0 : count - 1) : (state.active + delta + count) % count;
  renderList(input, parts, state);
  renderGhost(input, parts, state);
}

/** Commit a suggestion: the canonical key, so the density lookup is guaranteed to hit. */
function accept(input: HTMLInputElement, name: string): void {
  accepting = true;
  try {
    input.value = name;
    input.setSelectionRange(name.length, name.length);
    close(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } finally {
    accepting = false;
  }
}

/**
 * The name Tab or Enter would commit, or null when nothing is highlighted.
 *
 * Null exactly when the field shows no ghost text, which is what stops Tab from rewriting a
 * name that is already valid and that the user only meant to tab away from. Reaching a
 * suggestion with the arrow keys is an explicit choice and does make it committable.
 */
const activeName = (state: State): string | null =>
  state.active >= 0 ? (state.matches[state.active]?.name ?? null) : null;

/**
 * Attach the typeahead to a form, suggesting from `densities`' keys (the ingredients whose
 * grams-per-cup ratio is known). Every listener is delegated, so it's a one-time call.
 */
export function initIngredientTypeahead(form: HTMLElement | null, densities: Densities): void {
  if (!form) return;
  GRAMS_PER_CUP = densities;
  NAMES = Object.keys(densities).sort();

  const nameInput = (target: EventTarget | null): HTMLInputElement | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest(NAME_FIELD);
    return el instanceof HTMLInputElement && el.closest('[data-typeahead]') ? el : null;
  };

  // Wire up ARIA as soon as a field is reached, so it announces as a combobox from the start.
  form.addEventListener('focusin', (e) => {
    const input = nameInput(e.target);
    const parts = input ? partsOf(input) : null;
    if (input && parts) stateOf(input, parts);
  });

  form.addEventListener('input', (e) => {
    if (accepting) return;
    const input = nameInput(e.target);
    const parts = input ? partsOf(input) : null;
    if (!input || !parts) return;
    stateOf(input, parts).dismissed = false; // typing revives a popup Escape closed
    refresh(input);
  });

  form.addEventListener('keydown', (e) => {
    const input = nameInput(e.target);
    if (!input || e.isComposing) return;
    const state = states.get(input);
    const open = isOpen(input);

    switch (e.key) {
      case 'Tab': {
        // Taken only to commit a highlighted suggestion. Shift+Tab never is, and neither is a
        // Tab with nothing highlighted — tabbing through the row's fields has to behave
        // exactly as it does everywhere else in the form.
        const name = open && !e.shiftKey && state ? activeName(state) : null;
        if (!name) {
          if (open) close(input);
          return;
        }
        e.preventDefault();
        accept(input, name);
        return;
      }
      case 'Enter': {
        // With nothing highlighted, Enter keeps the meaning it has everywhere else on this
        // page and publishes the recipe.
        const name = open && state ? activeName(state) : null;
        if (!name) return;
        e.preventDefault();
        accept(input, name);
        return;
      }
      case 'ArrowDown': {
        if (open) {
          e.preventDefault();
          move(input, 1);
          return;
        }
        const parts = partsOf(input);
        if (parts) stateOf(input, parts).dismissed = false;
        refresh(input);
        if (isOpen(input)) e.preventDefault();
        return;
      }
      case 'ArrowUp': {
        if (!open) return;
        e.preventDefault();
        move(input, -1);
        return;
      }
      case 'Escape': {
        if (!open) return;
        e.preventDefault();
        if (state) state.dismissed = true;
        close(input);
        return;
      }
    }
  });

  // Leaving the field never commits the ghost — only Tab, Enter or a click do.
  form.addEventListener('focusout', (e) => {
    const input = nameInput(e.target);
    if (input) close(input);
  });

  // Keep focus in the input so focusout can't tear the list down before the click lands.
  form.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest(`.${OPTION_CLASS}`)) e.preventDefault();
  });

  form.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const option = e.target.closest<HTMLElement>(`.${OPTION_CLASS}`);
    if (!option) return;
    const input = option.closest('[data-typeahead]')?.querySelector<HTMLInputElement>(NAME_FIELD);
    const state = input ? states.get(input) : undefined;
    const match = state?.matches[Number(option.dataset.index)];
    if (input && match) accept(input, match.name);
  });

  form.addEventListener('compositionstart', (e) => {
    const input = nameInput(e.target);
    const parts = input ? partsOf(input) : null;
    if (!input || !parts) return;
    stateOf(input, parts).composing = true;
    close(input);
  });

  form.addEventListener('compositionend', (e) => {
    const input = nameInput(e.target);
    const parts = input ? partsOf(input) : null;
    if (!input || !parts) return;
    stateOf(input, parts).composing = false;
    refresh(input);
  });
}
