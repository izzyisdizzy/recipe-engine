# @izzy/recipe-engine

The recipe engine behind [izzybennett.com/recipes](https://izzybennett.com/recipes/),
extracted as a package for Astro sites:

| Export | What it does |
| :-- | :-- |
| `@izzy/recipe-engine/components/Recipe.astro` | A full recipe page body: meta, tools, ingredients with a US ↔ grams toggle, linked steps with popovers and "Show amounts", notes |
| `@izzy/recipe-engine/components/RecipeCard.astro` | One searchable/filterable row for a recipe index |
| `@izzy/recipe-engine/styles/recipes.css` | Styles for the popovers and inline amounts, plus Tailwind `@source` registration — **required** with the components |
| `@izzy/recipe-engine/styles/theme.css` | Optional default `--color-accent-*` palette |
| `@izzy/recipe-engine/schema` | `recipeSchema` (a content-collection schema factory), `categoryValues`, and the `RecipeEntry` / `RecipeData` types |
| `@izzy/recipe-engine/units` | Quantity parsing and US-volume → grams conversion against a density table |
| `@izzy/recipe-engine/ingredients` | Links ingredient mentions in step HTML to their measurements |
| `@izzy/recipe-engine/markdown` | Inline markdown rendering for steps and notes |
| `@izzy/recipe-engine/ingredient-suggest` | Ranking for an ingredient-name typeahead |
| `@izzy/recipe-engine/ingredient-popover`, `/recipe-units`, `/recipe-amounts` | The client scripts the `Recipe` component runs (exported for reuse/testing) |
| `@izzy/recipe-engine/seed/densities.json` | A starter density table (grams per cup) |

## Install

No registry — pin by git tag:

```json
"@izzy/recipe-engine": "github:izzyisdizzy/recipe-engine#v1.1.0"
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
@import "@izzy/recipe-engine/styles/theme.css"; /* only if you don't define --color-accent-* */
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
