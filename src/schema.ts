/**
 * The recipe content-collection schema, as a factory so a site can hand it straight to
 * `defineCollection({ schema: recipeSchema })`.
 *
 * `z` must come from `astro/zod` (the same instance `astro:content` re-exports), never a
 * direct `zod` dependency — mixing zod v4 instances trips its brand checks. `image()` is
 * injected by Astro at validation time and resolves relative to each markdown entry, so the
 * factory works unchanged from inside a package.
 */
import { z } from 'astro/zod';
import type { SchemaContext } from 'astro/content/config';

export const categoryValues = ['main', 'dessert', 'side', 'sauce', 'drink', 'other'] as const;

export const recipeSchema = ({ image }: SchemaContext) =>
  z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.enum(categoryValues),
    // Not a browsable taxonomy — just extra keywords folded into recipe search.
    keywords: z.array(z.string()).default([]),
    prepTime: z.number().int().nonnegative().optional(),
    cookTime: z.number().int().nonnegative().optional(),
    servings: z.number().int().positive().optional(),
    tools: z.array(z.string()).default([]),
    ingredients: z.array(
      z.object({
        group: z.string().optional(),
        // Each item is structured so the recipe page can convert US measurements to grams.
        // qty/unit are optional: count or loose items ("1 lemon", "Salt to taste") have neither.
        items: z.array(
          z.object({
            name: z.string(),
            qty: z.string().optional(), // freeform to preserve "2 ¼", "6-8", "½"
            unit: z.string().optional(), // "cup", "tbsp", "oz", "g", … or absent for count items
            // Preparation note rendered after the name ("softened", "grated", "room temp").
            // Kept out of `name` so `name` stays a clean density-lookup and prose-matching key.
            detail: z.string().optional(),
          })
        ),
      })
    ),
    steps: z.array(
      z.object({
        group: z.string().optional(),
        items: z.array(z.string()),
      })
    ),
    notes: z.array(z.string()).default([]),
    image: image().optional(),
    draft: z.boolean().default(false),
  });

/** A recipe's validated frontmatter, as Astro hands it to pages. */
export type RecipeData = z.output<ReturnType<typeof recipeSchema>>;

/**
 * The slice of a content-collection entry the components need. Structural on purpose:
 * `CollectionEntry<'recipes'>` is generated into the consuming site's `.astro/` types and
 * can't be named from a package, but it is assignable to this because both derive from
 * `recipeSchema`.
 */
export interface RecipeEntry {
  id: string;
  data: RecipeData;
}
