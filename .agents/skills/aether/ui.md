# UI Patterns

## Vuetify Layout System

- Use Vuetify components (`v-card`, `v-btn`, `v-data-table`) over custom implementations
- Use Vuetify spacing utilities (`pa-4`, `ma-2`) and grid system (`v-row`, `v-col`)

## Page scrolling — natural scroll is the default

Pages **scroll naturally** inside `<v-main>`, like a normal document: a long
overview / detail / config page just grows and the window scrolls, no wiring
needed. Don't reach for `fill-height` / fixed-height shells by default.

Only **chat / graph / canvas** pages that own their own internal scroll
container need the locked, fixed-height pattern. Opt in by adding the
`app-scroll-locked` class (on the page root, a layout, or `<body>`); see
`assets/brand-globals.css`. Don't pin the whole app to the viewport globally —
a fixed-height `overflow: hidden` shell silently **clips** any naturally-flowing
page (content renders but is invisible, no error), which is a costly
invisible-failure trap.

### Template gotcha — never write `.value` in `{{ }}` or `v-bind`

Vue **auto-unwraps** top-level refs in templates. Writing `myRef.value` in a
template evaluates `.value` against the already-unwrapped value and silently
yields `undefined`/`0` — e.g. `Object.keys(snapshots.value || {}).length`
returns `0`. Use the ref name directly (`snapshots`); keep `.value` to
`<script>`.

## Page Layout Template (opt-in internal scroll)

When a page genuinely needs a fixed header + its OWN scroll region (e.g. a
chat/graph view under `app-scroll-locked`), use flexbox:

- **Wrap the page root in `<v-container fluid class="fill-height pa-0">`** —
  this is the piece that makes the internal scroll actually work. Vuetify's
  `fill-height` is just `height: 100% !important`, and `<v-main>` only
  propagates a concrete height to a child that is itself a Vuetify flex
  context (a `v-container` with `fill-height`). A bare `<div>` root doesn't
  inherit that height, so it grows unbounded — `flex-grow-1 overflow-y-auto`
  further down then has no fixed height to constrain against, and the page
  grows to fit its content instead of scrolling.
- Inside that container, use a column `<div class="d-flex flex-column">` with
  `style="height: 100%; width: 100%"` (not `fill-height` on the div — it has
  no Vuetify flex parent to inherit `100%` from at that level).
- `flex-shrink-0` on fixed elements (header, toolbar)
- `flex-grow-1 overflow-y-auto` on scrollable content
- Never use `calc(100vh - Xpx)` -- let flexbox handle sizing
- Never nest multiple scroll containers

Full page template covering all four data states (loading, error, empty, content):

```vue
<template>
    <v-container fluid class="fill-height pa-0">
        <div class="d-flex flex-column" style="height: 100%; width: 100%">
            <div class="flex-shrink-0 pa-4">
                <PageHeader title="Page Title" icon="mdi-view-dashboard" />
            </div>
            <div class="flex-grow-1 overflow-y-auto pa-4">
                <v-progress-circular v-if="loading" indeterminate class="ma-auto d-block" />
                <v-alert v-else-if="error" type="error" variant="tonal" closable>
                    {{ error }}
                </v-alert>
                <v-empty-state
                    v-else-if="!items.length"
                    headline="No data yet"
                    icon="mdi-database-off"
                />
                <div v-else>
                    <!-- Content here -->
                </div>
            </div>
        </div>
    </v-container>
</template>
```

## Dialogs

- Cards inside `v-dialog` automatically get `variant="flat"` (solid background) via the nested Vuetify default in `nuxt.config.ts`. No manual override needed.
- Use `v-card` directly inside `v-dialog` — it will have a solid surface background despite the global `outlined` default.
- See [cookbook.md](cookbook.md) in this skill for a full dialog pattern.

## Loading States

Use `v-progress-circular` for inline loading and `v-skeleton-loader` for layout-preserving placeholders:

```vue
<v-progress-circular v-if="loading" indeterminate />
<div v-else>
    <!-- Content -->
</div>
```

## Data Tables

```vue
<v-data-table :headers="headers" :items="items" :loading="loading" density="comfortable" hover>
    <template v-slot:item.actions="{ item }">
        <v-btn icon size="small" @click="selectItem(item)">
            <v-icon>mdi-eye</v-icon>
        </v-btn>
    </template>
</v-data-table>
```

## Rendering agent responses — agent text is Markdown, render it

**LLM/ADK agents reply in GitHub-flavoured Markdown** — tables, `**bold**`,
bullet/numbered lists, headings, code. If you bind that text raw
(`{{ turn.answer }}` / `{{ message.text }}`) the user sees literal
`| col | col |` pipes and `**stars**`, not a table. **Any surface that
shows an agent reply must render the Markdown.**

The built-in chat (`components/ChatMessage.vue`) already does this via
`utils/renderMarkdown.ts` (a dependency-free, **escape-first** renderer —
safe for `v-html`). When you build your **own** Ask/answer panel (a custom
page rarely reuses `ChatMessage`), render the same way — don't reinvent
`{{ answer }}`:

```vue
<script setup lang="ts">
    // Explicit import — this template disables utils/ auto-import in
    // nuxt.config.ts (`imports:dirs`), so utils are NOT auto-imported.
    import { renderMarkdown } from '~/utils/renderMarkdown';
</script>

<template>
    <!-- WRONG: prints raw pipes/stars -->
    <div>{{ turn.answer }}</div>

    <!-- RIGHT: renders tables/lists/bold (renderMarkdown escapes first) -->
    <div class="md-body" v-html="renderMarkdown(turn.answer)" />
</template>
```

> **`renderMarkdown` HTML-escapes the input before emitting any tags**, so
> agent output can't inject markup — only the tags it recognises from
> Markdown tokens are produced. Keep user-typed text verbatim
> (`white-space: pre-wrap`); only agent replies go through the renderer.

> **Verify the rendered surface, not just the build.** A missing `utils`
> import (auto-import is off here) or a swallowed error renders nothing or
> raw text **without failing `nuxt build`** — open the page and confirm the
> table actually renders before calling it done.
