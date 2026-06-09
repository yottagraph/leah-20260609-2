# Data-fetching cookbook

Copy-paste patterns that call the Elemental API, gateway, or helpers. For platform API details see [data.md](data.md) in this skill. Pure UI patterns (tables, forms, charts) are in [cookbook.md](cookbook.md).

> **Reads must work on `enable_lovelace_apps` tenants too.** Those tenants serve
> their own **in-cluster** Query Server, reachable **only server-side** (the
> Portal gateway proxy is not pointed at it). So the portable pattern is:
> **fetch from a same-origin Nitro route** (`server/api/*.ts`) that calls
> `qsFetch()` from `~/server/utils/elementalQs` — it auto-selects the in-cluster
> QS (+ M2M token) on those tenants and the gateway proxy otherwise (see
> [server-data.md](server-data.md)). **Never hand-build `${gatewayUrl}/api/qs/...`
> in the browser:** on a custom-QS tenant the proxy falls back to the platform
> **prod** graph, so the call returns the wrong data with a `200`. The
> client-only recipes below that hit the gateway / `useElementalClient()`
> directly work on proxy/Vercel tenants; on in-cluster tenants, route them
> through a server route as in recipe #1.

## 1. Entity Search Page

Search for entities by name and display results. `POST /entities/search` (batch
name resolution with scored ranking) isn't wrapped by the generated
`useElementalClient()`, so we call it via `qsFetch` in a **same-origin server
route** — which works on both proxy and in-cluster (`enable_lovelace_apps`)
tenants. The page just `$fetch`es that route.

```ts
// server/api/entity/search.get.ts
import { isQsConfigured, qsFetch } from '~/server/utils/elementalQs';

export default defineEventHandler(async (event) => {
    const q = String(getQuery(event).q ?? '').trim();
    if (!q) return { matches: [] };
    if (!isQsConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'Query Server not configured' });
    }

    const res = (await qsFetch('entities/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            queries: [{ queryId: 1, query: q }],
            maxResults: 10,
            includeNames: true,
        }),
        timeout: 15000,
    })) as any;

    const matches = (res?.results?.[0]?.matches ?? []).map((m: any) => ({
        neid: String(m?.neid ?? ''),
        name: String(m?.name ?? m?.neid ?? ''),
    }));
    return { matches };
});
```

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Entity Search</h1>
        <v-text-field
            v-model="query"
            label="Search entities"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            @keyup.enter="search"
            :loading="loading"
        />
        <v-alert v-if="error" type="error" variant="tonal" class="mt-2" closable>
            {{ error }}
        </v-alert>
        <v-list v-if="results.length" class="mt-4">
            <v-list-item v-for="r in results" :key="r.neid" :title="r.name" :subtitle="r.neid" />
        </v-list>
        <v-empty-state
            v-else-if="searched && !loading"
            headline="No results"
            icon="mdi-magnify-remove-outline"
        />
    </div>
</template>

<script setup lang="ts">
    const query = ref('');
    const results = ref<{ neid: string; name: string }[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const searched = ref(false);

    async function search() {
        if (!query.value.trim()) return;
        loading.value = true;
        error.value = null;
        searched.value = true;
        try {
            const { matches } = await $fetch<{ matches: { neid: string; name: string }[] }>(
                '/api/entity/search',
                { query: { q: query.value.trim() } }
            );
            results.value = matches;
        } catch (e: any) {
            error.value = e.message || 'Search failed';
            results.value = [];
        } finally {
            loading.value = false;
        }
    }
</script>
```

## 2. News Feed — Recent Articles with Sentiment

Fetch recent articles from the knowledge graph. Uses `useElementalSchema()`
for runtime flavor/PID discovery and `buildGatewayUrl()` for gateway access.

> **Doing this for a whole watchlist/portfolio?** Don't loop this per entity.
> When you already hold a set of NEIDs, the batch **galaxy/prism** surface
> returns one news/event slice across all of them in a single call — see
> recipe #6 and [galaxy-prism.md](galaxy-prism.md).

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Recent News</h1>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable>
            {{ error }}
        </v-alert>
        <v-progress-linear v-if="loading" indeterminate class="mb-4" />
        <v-list v-if="articles.length" lines="three">
            <v-list-item v-for="a in articles" :key="a.neid">
                <template #title>
                    <span>{{ a.name || a.neid }}</span>
                    <v-chip
                        v-if="a.sentiment"
                        size="x-small"
                        class="ml-2"
                        :color="a.sentiment > 0 ? 'success' : a.sentiment < 0 ? 'error' : 'grey'"
                    >
                        {{ a.sentiment > 0 ? 'Bullish' : a.sentiment < 0 ? 'Bearish' : 'Neutral' }}
                    </v-chip>
                </template>
                <template #subtitle>{{ a.neid }}</template>
            </v-list-item>
        </v-list>
        <v-empty-state
            v-else-if="!loading"
            headline="No articles found"
            icon="mdi-newspaper-variant-outline"
        />
    </div>
</template>

<script setup lang="ts">
    import { useElementalClient } from '@yottagraph-app/elemental-api/client';
    import { padNeid } from '~/utils/elementalHelpers';

    const client = useElementalClient();
    const { flavorByName, pidByName, refresh: loadSchema } = useElementalSchema();

    const articles = ref<{ neid: string; name: string; sentiment: number | null }[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    onMounted(async () => {
        loading.value = true;
        try {
            await loadSchema();
            const articleFid = flavorByName('article');
            if (!articleFid) {
                error.value = 'Article entity type not found in schema';
                return;
            }

            const res = await client.findEntities({
                expression: JSON.stringify({ type: 'is_type', is_type: { fid: articleFid } }),
                limit: 20,
            });
            const neids: string[] = (res as any).eids ?? [];

            if (!neids.length) {
                return;
            }

            const namePid = pidByName('name');
            const sentimentPid = pidByName('sentiment');
            const pids = [namePid, sentimentPid].filter((p): p is number => p !== null);

            const props = await client.getPropertyValues({
                eids: JSON.stringify(neids),
                pids: JSON.stringify(pids),
            });

            const valueMap = new Map<string, Record<number, any>>();
            for (const v of (props as any).values ?? []) {
                const eid = padNeid(v.eid ?? v.entity_id ?? '');
                if (!valueMap.has(eid)) valueMap.set(eid, {});
                valueMap.get(eid)![v.pid] = v.value;
            }

            articles.value = neids.map((neid) => {
                const vals = valueMap.get(neid) ?? {};
                return {
                    neid,
                    name: namePid ? ((vals[namePid] as string) ?? neid) : neid,
                    sentiment: sentimentPid ? ((vals[sentimentPid] as number) ?? null) : null,
                };
            });
        } catch (e: any) {
            error.value = e.message || 'Failed to load articles';
        } finally {
            loading.value = false;
        }
    });
</script>
```

## 3. Entity Search with Gateway Helpers

Simpler version of recipe #1 using the pre-built `searchEntities()` helper.

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Entity Search</h1>
        <v-text-field
            v-model="query"
            label="Search entities"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            @keyup.enter="search"
            :loading="loading"
        />
        <v-alert v-if="error" type="error" variant="tonal" class="mt-2" closable>
            {{ error }}
        </v-alert>
        <v-list v-if="results.length" class="mt-4">
            <v-list-item v-for="r in results" :key="r.neid" :title="r.name" :subtitle="r.neid" />
        </v-list>
        <v-empty-state
            v-else-if="searched && !loading"
            headline="No results"
            icon="mdi-magnify-remove-outline"
        />
    </div>
</template>

<script setup lang="ts">
    import { searchEntities } from '~/utils/elementalHelpers';

    const query = ref('');
    const results = ref<{ neid: string; name: string }[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const searched = ref(false);

    async function search() {
        if (!query.value.trim()) return;
        loading.value = true;
        error.value = null;
        searched.value = true;
        try {
            results.value = await searchEntities(query.value.trim());
        } catch (e: any) {
            error.value = e.message || 'Search failed';
            results.value = [];
        } finally {
            loading.value = false;
        }
    }
</script>
```

## 4. Get Filings for a Company

Fetch Edgar filings (or any relationship-linked documents) for an organization.
Uses `$fetch` for the initial entity search because `POST /entities/search`
is not wrapped by the generated client (same as recipe #1). Filing
properties are then fetched via `useElementalClient()`.

> The inline `getSearchUrl()` / `getEntityNameUrl()` + `X-Api-Key` calls below
> hit the gateway directly and work on **proxy/Vercel tenants only**. On an
> `enable_lovelace_apps` tenant they read **prod** — move both the search and
> the name resolution into a server route that uses `qsFetch` (recipe #1's
> `/api/entity/search` is the template; add an `/api/entity/name` the same way).

**Important:** For graph-layer entities (person, organization, location),
use `findEntities` with a `linked` expression. For property-layer entities
(documents, filings, articles), use `getPropertyValues` with the
relationship PID. See [data.md](data.md) for the two-layer architecture.

> **Scaling to many companies?** The `docNeids.map(... fetch name ...)`
> fanout below is exactly the N+1 pattern the prism bundles collapse:
> `relationship-universe` returns typed neighbors with names inlined, and
> `entities/names` resolves a whole NEID set in one call. See recipe #6 and
> [galaxy-prism.md](galaxy-prism.md).

```vue
<template>
    <div class="d-flex flex-column fill-height pa-4">
        <h1 class="text-h5 mb-4">Company Filings</h1>
        <v-text-field
            v-model="query"
            label="Company name"
            prepend-inner-icon="mdi-magnify"
            @keyup.enter="search"
            :loading="loading"
        />
        <v-alert v-if="error" type="error" variant="tonal" class="mt-2" closable>
            {{ error }}
        </v-alert>
        <v-data-table
            v-if="filings.length"
            :headers="headers"
            :items="filings"
            :loading="loading"
            density="comfortable"
            hover
            class="mt-4"
        />
        <v-empty-state
            v-else-if="searched && !loading"
            headline="No filings found"
            icon="mdi-file-document-off"
        />
    </div>
</template>

<script setup lang="ts">
    import { useElementalClient } from '@yottagraph-app/elemental-api/client';

    const client = useElementalClient();
    const query = ref('');
    const filings = ref<{ neid: string; name: string }[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const searched = ref(false);

    const headers = [
        { title: 'NEID', key: 'neid', sortable: true },
        { title: 'Name', key: 'name', sortable: true },
    ];

    async function getPropertyPidMap(client: ReturnType<typeof useElementalClient>) {
        const schemaRes = await client.getSchema();
        const properties = schemaRes.schema?.properties ?? (schemaRes as any).properties ?? [];
        return new Map(properties.map((p: any) => [p.name, p.pid]));
    }

    function getSearchUrl() {
        const config = useRuntimeConfig();
        const gw = (config.public as any).gatewayUrl as string;
        const org = (config.public as any).tenantOrgId as string;
        return `${gw}/api/qs/${org}/entities/search`;
    }

    function getApiKey() {
        return (useRuntimeConfig().public as any).qsApiKey as string;
    }

    async function search() {
        if (!query.value.trim()) return;
        loading.value = true;
        error.value = null;
        searched.value = true;
        try {
            const res = await $fetch<any>(getSearchUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': getApiKey() },
                body: {
                    queries: [{ queryId: 1, query: query.value.trim(), flavors: ['organization'] }],
                    maxResults: 1,
                    includeNames: true,
                },
            });
            const matches = res?.results?.[0]?.matches ?? [];
            if (!matches.length) {
                filings.value = [];
                return;
            }
            const orgNeid = matches[0].neid;

            const pidMap = await getPropertyPidMap(client);
            const filedPid = pidMap.get('filed');
            if (!filedPid) {
                error.value = '"filed" relationship not found in schema';
                return;
            }

            const propRes = await client.getPropertyValues({
                eids: JSON.stringify([orgNeid]),
                pids: JSON.stringify([filedPid]),
            });

            const docNeids = (propRes.values ?? []).map((v: any) =>
                String(v.value).padStart(20, '0')
            );

            function getEntityNameUrl(neid: string) {
                const config = useRuntimeConfig();
                const gw = (config.public as any).gatewayUrl as string;
                const org = (config.public as any).tenantOrgId as string;
                return `${gw}/api/qs/${org}/entities/${neid}/name`;
            }

            const names = await Promise.all(
                docNeids.map(async (neid: string) => {
                    try {
                        const res = await $fetch<{ name: string }>(getEntityNameUrl(neid), {
                            headers: { 'X-Api-Key': getApiKey() },
                        });
                        return res.name || neid;
                    } catch {
                        return neid;
                    }
                })
            );

            filings.value = docNeids.map((neid: string, i: number) => ({
                neid,
                name: names[i],
            }));
        } catch (e: any) {
            error.value = e.message || 'Failed to load filings';
            filings.value = [];
        } finally {
            loading.value = false;
        }
    }
</script>
```

## 5. Async Entity Search with Live Suggestions

Type-ahead search that shows results in a dropdown as the user types. Uses
`searchEntities()` from the gateway helpers with a debounced watcher.

> **Do not use `v-autocomplete` for async search.** Vuetify's `v-autocomplete`
> with `hide-no-data` + `no-filter` + async item loading has a timing bug:
> the menu hides while items are empty (during the fetch) and does not reopen
> when results arrive. Use `v-text-field` with a manual dropdown instead.

```vue
<template>
    <div class="entity-search" style="position: relative">
        <v-text-field
            v-model="searchQuery"
            :label="label"
            :prepend-inner-icon="icon"
            variant="solo-filled"
            rounded="lg"
            clearable
            density="comfortable"
            :loading="searching"
            @focus="showMenu = suggestions.length > 0"
            @click:clear="onClear"
        />

        <v-card v-if="showMenu && suggestions.length > 0" class="search-dropdown" elevation="8">
            <v-list density="compact">
                <v-list-item
                    v-for="item in suggestions"
                    :key="item.neid"
                    :title="item.name"
                    :subtitle="item.neid"
                    @click="onSelect(item)"
                />
            </v-list>
        </v-card>
    </div>
</template>

<script setup lang="ts">
    import { searchEntities } from '~/utils/elementalHelpers';

    const props = withDefaults(
        defineProps<{
            label?: string;
            icon?: string;
            flavors?: string[];
        }>(),
        { label: 'Search', icon: 'mdi-magnify', flavors: undefined }
    );

    const emit = defineEmits<{
        selected: [entity: { neid: string; name: string }];
    }>();

    const searchQuery = ref('');
    const suggestions = ref<{ neid: string; name: string }[]>([]);
    const searching = ref(false);
    const showMenu = ref(false);
    let selectedName = '';
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    watch(searchQuery, (val) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (val === selectedName) return;
        if (!val || val.length < 2) {
            suggestions.value = [];
            showMenu.value = false;
            return;
        }
        debounceTimer = setTimeout(() => doSearch(val), 300);
    });

    async function doSearch(query: string) {
        searching.value = true;
        try {
            suggestions.value = await searchEntities(query, {
                maxResults: 8,
                flavors: props.flavors,
            });
            showMenu.value = suggestions.value.length > 0;
        } catch {
            suggestions.value = [];
            showMenu.value = false;
        } finally {
            searching.value = false;
        }
    }

    function onSelect(item: { neid: string; name: string }) {
        selectedName = item.name;
        searchQuery.value = item.name;
        suggestions.value = [];
        showMenu.value = false;
        emit('selected', item);
    }

    function onClear() {
        selectedName = '';
        suggestions.value = [];
        showMenu.value = false;
    }

    onMounted(() => {
        document.addEventListener('click', (e) => {
            const el = (e.target as HTMLElement)?.closest('.entity-search');
            if (!el) showMenu.value = false;
        });
    });
</script>

<style scoped>
    .entity-search {
        max-width: 600px;
    }

    .search-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        z-index: 100;
        max-height: 300px;
        overflow-y: auto;
        margin-top: -8px;
    }
</style>
```

Usage:

```vue
<EntitySearch
    label="Search for a company"
    icon="mdi-domain"
    :flavors="['organization']"
    @selected="onCompanySelected"
/>
```

## 6. Batch reads across many entities (galaxy / prism)

Recipes #2 and #4 fetch one entity (or loop per entity). When you already
hold a **set** of NEIDs — a watchlist, a portfolio, the neighbors you just
fetched — don't loop: the **galaxy/prism** batch surface answers "tell me
about _all_ of these in one call." See [galaxy-prism.md](galaxy-prism.md) for
the full surface (galaxy primitives + the ten prism lenses + five bundles);
here's the shape.

This pulls recent events for a whole watchlist in **two** calls total (one
`scan-events`, one batched name resolve) instead of N+1 fanout. Two things to
know: the prism envelope key is `records` (with a parallel `coverage` array),
and the thin lenses return **bare NEIDs**, so names are resolved separately
via `POST /entities/names`.

```vue
<template>
    <v-data-table :headers="headers" :items="rows" :loading="loading" density="comfortable" />
</template>

<script setup lang="ts">
    import { buildGatewayUrl, getApiKey, padNeid } from '~/utils/elementalHelpers';

    // A KNOWN NEID set (e.g. a saved watchlist) — not a fresh search.
    const watchlist = ['05867431084638762877', '00012345678901234567'];
    const rows = ref<{ neid: string; name: string; event: string; time: string }[]>([]);
    const loading = ref(false);

    const headers = [
        { title: 'Entity', key: 'name' },
        { title: 'Event', key: 'event' },
        { title: 'When', key: 'time' },
    ];

    onMounted(async () => {
        loading.value = true;
        try {
            const neids = watchlist.map(padNeid);
            const hdrs = { 'X-Api-Key': getApiKey(), 'Content-Type': 'application/json' };

            // 1 call: recent events for the WHOLE set (envelope key is `records`).
            const { records } = await $fetch<{ records: any[]; coverage: string[] }>(
                buildGatewayUrl('prism/scan-events'),
                { method: 'POST', headers: hdrs, body: { neids, window_days: 365 } }
            );

            // 1 call: resolve every NEID's name (lenses return bare NEIDs).
            const { results } = await $fetch<{ results: Record<string, string> }>(
                buildGatewayUrl('entities/names'),
                { method: 'POST', headers: hdrs, body: { neids } }
            );

            rows.value = (records ?? []).map((r) => ({
                neid: r.neid,
                name: results[r.neid] ?? r.neid,
                event: r.event_type ?? r.category ?? r.event,
                time: r.time,
            }));
        } finally {
            loading.value = false;
        }
    });
</script>
```

Swap `scan-events` for any other lens (`scan-fundamentals`, `scan-filings`,
`scan-governance`, …) — same two-call shape, just a different envelope key
per the table in [galaxy-prism.md](galaxy-prism.md). For typed neighbors or
ownership chains with names already inlined, reach for the `relationship-universe`
/ `acs-bundle` bundles instead of stitching lenses together yourself.

## 7. One server route per workflow (resolve → fetch → persist)

When a user action triggers a **multi-step** flow — resolve some names, fetch
data for them, then save the result to prefs — do the whole thing in **one
server route**, not a chain of client-side `await`s plus a reactive watcher.
The client-side version is racy: two awaits + a watcher firing mid-flight
re-orders writes, double-runs the fetch, or persists a half-built state. The
robust shape is: the route does N batched calls + persists, returns the final
state, and the client just primes its cache from the response.

Use `qsRequest()` (status-preserving) + an `AetherEnvelope` so a data-plane
failure surfaces honestly instead of saving an empty result as if it were real
(see [server-data.md](server-data.md)).

```typescript
// server/api/portfolio/seed.post.ts  →  POST /api/portfolio/seed
import { qsRequest } from '~/server/utils/elementalQs';
import { ready, degraded } from '~/server/utils/envelope';

export default defineEventHandler(async (event) => {
    const { names } = await readBody<{ names: string[] }>(event);

    // 1. Resolve all names in ONE batched search (match on echoed queryId;
    //    pick the `organization` flavor — see data.md § flavor-aware).
    const search = await qsRequest<any>('entities/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            queries: names.map((q, i) => ({ queryId: i, query: q })),
            maxResults: 5,
            includeNames: true,
            includeFlavors: true,
        }),
    });
    if (!search.ok)
        return degraded(
            { holdings: [] },
            'upstream_error',
            `entities/search → ${search.status ?? 'no response'}`
        );

    const holdings = (search.body?.results ?? [])
        .map((r: any) => {
            const m =
                (r.matches ?? []).find((x: any) => x.flavor === 'organization') ?? r.matches?.[0];
            return m ? { neid: m.neid, name: m.name } : null;
        })
        .filter(Boolean);

    // 2. One batched fetch for the WHOLE set (not a per-NEID loop).
    const neids = holdings.map((h: any) => h.neid);
    const scan = await qsRequest<any>('prism/scan-fundamentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ neids, window_days: 540 }),
    });
    if (!scan.ok)
        return degraded(
            { holdings },
            'upstream_error',
            `prism/scan-fundamentals → ${scan.status ?? 'no response'}`
        );

    // 3. Persist LAST (e.g. write a snapshot row / prefs) — only once the
    //    real data is in hand. Return the final state so the client primes
    //    its cache from the response rather than re-fetching.
    const snapshot = { holdings, records: scan.body?.records ?? [], seededAt: Date.now() };
    // await saveSnapshot(snapshot);  // Cloud SQL / Firestore prefs, etc.

    return ready(snapshot);
});
```

Client side is then a single call — no watcher, no race:

```typescript
const env = await $fetch('/api/portfolio/seed', { method: 'POST', body: { names } });
if (env.state !== 'ready') showBanner(env.reason); // honest degraded state
state.value = env.data; // prime cache from the response
```

**Rule of thumb:** any "do a workflow that touches multiple endpoints and
writes prefs/state" belongs in one server route. The client primes its cache
from the response; pref writes happen last, server-side.
