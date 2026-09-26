# @izzy/recipe-engine

The recipe logic behind [izzybennett.com/recipes](https://izzybennett.com/recipes/),
extracted as a package for Astro sites:

| Export | What it does |
| :-- | :-- |
| `@izzy/recipe-engine/schema` | `recipeSchema` (a content-collection schema factory) and `categoryValues` |
| `@izzy/recipe-engine/units` | Quantity parsing and US-volume → grams conversion against a density table |
| `@izzy/recipe-engine/ingredients` | Links ingredient mentions in step HTML to their measurements (hover/tap popovers) |
| `@izzy/recipe-engine/markdown` | Inline markdown rendering for steps and notes |
| `@izzy/recipe-engine/ingredient-suggest` | Ranking for an ingredient-name typeahead |
| `@izzy/recipe-engine/ingredient-popover` | Client-side tap-toggle wiring for the popovers |
| `@izzy/recipe-engine/seed/densities.json` | A starter density table (grams per cup) |

## Install

No registry — pin by git tag:

```json
"@izzy/recipe-engine": "github:izzyisdizzy/recipe-engine#v1.0.0"
```

The package ships raw TypeScript. `astro` is a peer dependency, which is what makes Vite
compile it from `node_modules` rather than externalizing it.

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

The density table is the consumer's data, not the package's — pass your own to
`toGrams` / `rankIngredientSuggestions`. `seed/densities.json` is just a starting point.

## Gotchas

- **Clear `.astro/` after bumping this package.** Astro caches the content store keyed on
  the bytes of `content.config.ts` itself, not its imports — a schema change here won't
  invalidate it. Add `"prebuild": "rm -rf .astro"` to the consuming site.
- **Styles are not included (yet).** `ingredients.ts` emits `ing-*` classes; the consuming
  site styles them.
- **Don't add a direct `zod` dependency.** The schema uses `astro/zod`; mixing zod
  instances trips zod v4's brand checks.

## Development

Node ≥ 22.12 (node 26 breaks the Astro toolchain).

```sh
npm ci
npm run typecheck
npm run test
```
