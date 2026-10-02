# @izzy/recipe-engine

The recipe engine behind [izzybennett.com/recipes](https://izzybennett.com/recipes/),
extracted as a package for Astro sites:

| Export | What it does |
| :-- | :-- |
| `@izzy/recipe-engine/components/Recipe.astro` | A full recipe page body: meta (yield, prep, cook, oven), tools, ingredients with a scale control (⅓ ½ 1× 2× 3×) and a US ↔ grams toggle, linked steps (`[[key]]` references + lexical matching) with popovers and "Show amounts", notes |
| `@izzy/recipe-engine/components/RecipeCard.astro` | One searchable/filterable row for a recipe index |
| `@izzy/recipe-engine/styles/recipes.css` | Styles for the recipe page (`.rx-*`, including the section windows), the popovers, inline amounts and the typeahead, plus Tailwind `@source` registration — **required** with the components |
| `@izzy/recipe-engine/styles/theme.css` | Default Dizzy token values, for sites that don't define the Dizzy tokens themselves |
| `@izzy/recipe-engine/schema` | `recipeSchema` (a content-collection schema factory), `categoryValues`, and the `RecipeEntry` / `RecipeData` types |
| `@izzy/recipe-engine/units` | Quantity parsing and US-volume → grams conversion against a density table |
| `@izzy/recipe-engine/scale` | Recipe scaling: `scaleQty("2 ¼", 2)` → `"4 ½"`, ranges included; exact fractions, no rounding |
| `@izzy/recipe-engine/ingredients` | Links ingredient mentions in step HTML to their measurements |
| `@izzy/recipe-engine/markdown` | Inline markdown rendering for steps and notes |
| `@izzy/recipe-engine/ingredient-suggest` | Ranking for an ingredient-name typeahead |
| `@izzy/recipe-engine/ingredient-typeahead` | The typeahead itself for an upload form: `initIngredientTypeahead(form, densities)` — ghost-text completion + listbox, styled by `recipes.css` |
| `@izzy/recipe-engine/ingredient-popover`, `/recipe-units`, `/recipe-amounts`, `/recipe-scale` | The client scripts the `Recipe` component runs (exported for reuse/testing) |
| `@izzy/recipe-engine/seed/densities.json` | A starter density table (grams per cup) |

## Install

No registry — pin by git tag:

```json
"@izzy/recipe-engine": "github:izzyisdizzy/recipe-engine#v2.2.0"
```

The package ships raw TypeScript and `.astro`. `astro` is a peer dependency and the package
carries the `astro-component` keyword, which is what makes Vite compile it from
`node_modules` rather than externalizing it.

## Usage

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { recipeSchema } from '@izzy/recipe-engine/schema';

const recipes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/recipes' }),
  schema: recipeSchema,
});
```

```css
/* your Tailwind entry stylesheet */
@import "tailwindcss";
@import "@izzy/recipe-engine/styles/recipes.css";
@import "@izzy/recipe-engine/styles/theme.css"; /* only if your site doesn't define the Dizzy tokens */
```

```astro
---
// src/pages/recipes/[...slug].astro — wrap it in your own layout
import Recipe from '@izzy/recipe-engine/components/Recipe.astro';
import densities from '../../data/densities.json';
const { recipe } = Astro.props; // a CollectionEntry<'recipes'>
---
<YourLayout title={recipe.data.title}>
  <Recipe recipe={recipe} densities={densities} editHref={`/edit/${recipe.id}`} />
</YourLayout>
```

The density table is the consumer's data, not the package's — pass your own.
`seed/densities.json` is just a starting point.

`editHref` is optional on both components. The edit link carries an `auth-only` class and
no styles of its own for visibility: define `.auth-only` in your site (e.g. hide it until
signed in), or omit `editHref`.

## v2: Dizzy, and the authoring additions

**Styling.** v2 renders on the [Dizzy](https://izzybennett.com/projects/this-site/) design system.
`recipes.css` reads only Dizzy token custom properties (`--hotpink`, `--font-display`,
`--radius-md`, …) and the components use Dizzy's `dz-*` classes (`dz-window`, `dz-tag`, `dz-seg`,
`dz-btn`, `dz-row`, `dz-link`), so a consuming site must load Dizzy's tokens **and** its `bundle.css`.
Since v2.1.0 each recipe section (tools, ingredients, steps, notes) renders as a Dizzy window
titled like a file (`ingredients.txt`, …), with its heading and toggles as the first body row;
`theme.css` supplies the window tokens (`--cocoa`, `--aqua`, `--shadow-sticker-lg`) for sites
without their own.
Nothing is keyed on `prefers-color-scheme`: the recipe follows whichever theme the site shows.
The client scripts only set `aria-pressed`; all pressed styling is CSS.

**Frontmatter** — every addition is optional, so v1 recipes validate unchanged:

| Field | Where | What |
| :-- | :-- | :-- |
| `yield` | recipe | "8 scones" — shown in the meta strip |
| `oven` | recipe | "400°F / 200°C" — shown in the meta strip |
| `key` | ingredient item | Handle for `[[key]]` in steps. Defaults to the slug of `name` ("cold butter" → `cold-butter`) |
| `grams` | ingredient item | Grams override where the density table can't convert ("2 medium apples") |

**Step references.** A step can name an ingredient explicitly as `[[key]]` or
`[[key|display text]]`. It resolves to exactly that item — its popover, its inline amount —
instead of the lexical guess, and prose without brackets keeps the lexical matching. An unknown
key, or a default key two items share (the same name in two groups), **fails the build** with a
message listing the recipe's keys; give one of the duplicates an explicit `key`.

```yaml
ingredients:
  - group: "Dough"
    items:
      - { name: "cold butter", key: "butter", qty: "½", unit: "cup", detail: "cubed" }
      - { name: "lemon", qty: "1", detail: "zested", grams: 6 }
steps:
  - items:
      - "Cut in the [[butter]], then add the [[lemon|lemon zest]]."
```

**Scaling (v2.2.0).** The Ingredients header carries a ⅓ ½ 1× 2× 3× control that rescales the
ingredient list, the step popovers and inline amounts, grams, and `servings`. Fractions stay
exact (¼ × ⅓ shows "1/12"). Amounts typed straight into step prose and the freeform `yield` are
not scaled, and the choice isn't stored — a recipe always opens as written.

**Typeahead ghost alignment.** `.ing-ta-ghost` takes its padding and border width from
`--ing-ta-ghost-padding` / `--ing-ta-ghost-border` (defaults `0.5rem 0.75rem` / `1px`). Set them
to match your name input.

## Gotchas

- **Import `styles/recipes.css`.** Tailwind never scans `node_modules`; without that import
  the components' utility classes silently vanish from your CSS.
- **Clear `.astro/` after bumping this package.** Astro caches the content store keyed on
  the bytes of `content.config.ts` itself, not its imports — a schema change here won't
  invalidate it. Add `"prebuild": "rm -rf .astro"` to the consuming site.
- **Don't add a direct `zod` dependency.** The schema uses `astro/zod`; mixing zod
  instances trips zod v4's brand checks.

## Development

Node ≥ 22.12 (node 26 breaks the Astro toolchain).

```sh
npm ci
npm run typecheck   # tsc + astro check
npm run test
```

See `CLAUDE.md` for the layout rules that keep the Tailwind scan correct.
