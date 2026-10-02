# CLAUDE.md

## What this is

`@izzy/recipe-engine` — the recipe schema, logic, components and styles behind
izzybennett.com/recipes, extracted from the `izzybennett.com` repo (see that repo's
decomposition history). Public. No npm registry: consumers pin a git tag
(`github:izzyisdizzy/recipe-engine#vX.Y.Z`), and the one real consumer is
`izzybennett.com` (`~/Development/izzybennett.com`), which owns all recipe *content*,
`densities.json`, routes and page layout.

Ships **raw TypeScript and `.astro`** — there is no build step. `astro` is a peer dependency
and `keywords` includes `astro-component`, which is what makes a consumer's Vite compile the
package instead of externalizing it.

### Layout

- `src/schema.ts` — `recipeSchema`, `categoryValues`, `RecipeEntry`/`RecipeData` types.
- `src/*.ts` — pure logic: `units`, `scale`, `ingredients`, `markdown`, `ingredient-suggest`, plus the
  client scripts `ingredient-typeahead` (takes the density table as a parameter) and
  `ingredient-popover` (both client-side, but they emit only hand-written `.ing-*` classes —
  never Tailwind utilities, since `src/` root is not scanned).
- `src/client/` — client scripts that toggle **Tailwind utility classes**
  (`recipe-units`, `recipe-amounts`), plus `recipe-scale`, which toggles none — it rewrites
  amount text.
- `src/components/` — `Recipe.astro`, `RecipeCard.astro`, `UnitsToggle.astro`, `ScaleControl.astro`. Since v2 they
  render on Dizzy: `dz-*` classes plus the hand-written `.rx-*` rules in `styles/recipes.css`.
- `styles/recipes.css` — hand-written `.ing-*` styles + the `@source` registration.
  `styles/theme.css` — default Dizzy token values for sites that don't define them.
- `seed/densities.json` — sample data for tests and standalone users only.

### Build / test

```sh
npm ci
npm run typecheck   # tsc --noEmit && astro check
npm run test        # vitest (happy-dom for client scripts)
```

Node ≥ 22.12; node 26 breaks the Astro toolchain. On Izzy's machine the default node is 26 —
use `PATH="/opt/homebrew/opt/node@22/bin:$PATH"`. CI (`.github/workflows/ci.yml`) runs both
on node 22. Pushing workflow files needs SSH (the gh HTTPS token lacks `workflow` scope).

### Invariants to preserve

- **Tailwind classes live only under `src/components/` or `src/client/`.** Consumers never
  scan `node_modules`; `styles/recipes.css` registers exactly those two directories. A
  utility class anywhere else silently disappears from the site's CSS. Don't "fix" this by
  adding a file or glob `@source`: Tailwind then scans that file's whole directory, and
  `src/` comments ("shadow", "invert") become dead CSS. Verified on Tailwind 4.3 / Astro 7.2.
- **Components don't own page chrome or auth.** No layout wrapper, no session code. Site
  concerns come in as props (`densities`, `editHref`, `href`); the edit link's `auth-only`
  class is gated by the consumer's CSS.
- **No direct `zod` dependency.** Import `z` from `astro/zod` — mixing zod v4 instances
  trips its brand checks.
- **Schema changes are migrations for the consumer.** A new required field invalidates
  every existing recipe file in izzybennett.com — give it a default or make it optional.
- **Styles read Dizzy tokens only.** Every colour/font/radius/shadow in `styles/recipes.css` is a
  Dizzy token custom property, and components use Dizzy `dz-*` classes; never hard-code a hex or
  key a rule on `prefers-color-scheme` (the site's theme toggle can't reach it). Client scripts
  set `aria-pressed` only — no class toggling.
- **`[[key]]` failures fail the build.** `lookupRef` in `src/ingredients.ts` throws on an unknown or
  ambiguous key on purpose: a typo must not render silently. Keep the message listing valid keys.
- **Storage keys are a contract.** `izzy-recipe-units` and `izzy-recipe-amounts` hold
  visitors' saved preferences; renaming one silently resets them.
- **Scaling rewrites from data attributes, never from text.** Amounts carry `data-qty` /
  `data-unit` / `data-grams` (and Serves `data-servings`) in all three renderings — list,
  popover, inline copy; `client/recipe-scale.ts` recomputes from those. The scale is
  deliberately not stored (a recipe always opens as written), and `scale.ts` never rounds a
  fraction: ¼ × ⅓ is "1/12". An amount scales whole or not at all — no `data-grams` on a
  quantity that can't be parsed.
- **Release = tag.** Bump `version`, tag `vX.Y.Z` on a commit that's on `main` (or will be
  kept by a non-squash merge), then bump the pin in izzybennett.com, whose `prebuild`
  clears the stale `.astro/` content cache.
