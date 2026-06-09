# Storage

This skill covers **transactional / state** storage — per-tenant
Firestore (always on for BC 2.0 tenants — ENG-520), the legacy KV
store (BC 1.0 tenants only), and Postgres (Cloud SQL on BC 2.0 / GKE,
Neon on BC 1.0 / Vercel — if provisioned). For **analytical /
append-only** reads from large datasets, see [`bigquery.md`](bigquery.md).

| Store                  | How to check                                              | Env var                                                                      | Utility file                                 | Always available?                                    |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| **Firestore** (prefs)  | `isFirestoreConfigured()` from `~/server/utils/firestore` | `NUXT_PUBLIC_FIRESTORE_*` + `NUXT_FIRESTORE_SA_KEY`                          | `server/utils/firestore.ts` (pre-scaffolded) | Yes for BC 2.0 tenants                               |
| **KV** (Upstash Redis) | `KV_REST_API_URL` in `.env` (BC 1.0 only)                 | `KV_REST_API_URL`, `KV_REST_API_TOKEN`                                       | `server/utils/redis.ts` (pre-scaffolded)     | Yes for BC 1.0 tenants                               |
| **Postgres**           | `isDbConfigured()` from `~/server/utils/db`               | `CLOUD_SQL_*` (BC 2.0 / GKE) **or** `DATABASE_URL` (BC 1.0 / Vercel / local) | `server/utils/db.ts` (pre-scaffolded)        | Only if Cloud SQL / Neon enabled at project creation |

For client-side user preferences that sit on top of Firestore (or KV
on legacy tenants), see [pref.md](pref.md) in this skill — that's the
right entrypoint for almost every prefs use case.

## Where credentials come from

**Deployed builds** (push to `main` → Vercel): storage env vars are
auto-injected and decrypted at runtime. Storage works with zero
configuration. **This is the primary development path** — push your code
and test on the deployed preview/production URL.

**Local dev / Cursor Cloud:**

- **Firestore prefs** — `npm run dev` falls back to a local-filesystem
  store at `.aether-dev-prefs/`. `useAppPrefs` / `useGlobalPrefs` /
  `useAppFeaturePrefs` / `useGlobalFeaturePrefs` persist across page
  refreshes without any cloud setup. Production builds never use the
  fallback. See [pref.md](pref.md) for details.
- **Postgres** — on GKE (BC 2.0) the Cloud SQL Auth Proxy sidecar isn't
  present locally, and `DATABASE_URL` is not injected for local dev, so
  `getDb()` returns `null`. Routes should handle that case (return a
  "database not configured" / "warming up" state or empty payload).

## Firestore (BC 2.0 prefs backend)

`server/utils/firestore.ts` is the per-tenant Firestore wrapper. It
inits `firebase-admin` from `NUXT_FIRESTORE_SA_KEY` (base64-encoded
service-account JSON, injected by the portal) and the
`NUXT_PUBLIC_FIRESTORE_PROJECT_ID` / `NUXT_PUBLIC_FIRESTORE_DATABASE_ID`
pair. Use `getFirestoreDb()` from server routes that need raw doc/
collection access; almost everything client-facing should go through
the prefs composables in [pref.md](pref.md).

```typescript
import { getFirestoreDb } from '~/server/utils/firestore';

const db = getFirestoreDb();
if (db) {
    // Example: a server-side ETL writing to its own per-tenant collection.
    await db.doc('etl/last-run').set({ at: Date.now() }, { merge: true });
}
```

`getFirestoreDb()` returns `null` when Firestore isn't configured (BC 1.0
tenant on KV, or local dev with the FS fallback). The pre-scaffolded
`/api/prefs/*` routes already handle the fallback case — only call
`getFirestoreDb()` directly when you need doc/collection access outside
the prefs surface.

### Checking Firestore availability (status chips, feature gates)

To report whether Firestore is wired up — e.g. a capability chip — use
`isFirestoreConfigured()` from `~/server/utils/firestore` (it reads
`process.env.NUXT_PUBLIC_FIRESTORE_ENABLED` + `…_PROJECT_ID` and returns
a boolean). This is the same check `/api/prefs/status` uses, so your
chip can't disagree with the actual prefs backend:

```typescript
// server/api/<your>/status.get.ts
import { isFirestoreConfigured } from '~/server/utils/firestore';

export default defineEventHandler(() => ({
    firestore: isFirestoreConfigured(), // canonical, returns boolean
}));
```

> **⚠️ Don't compare `runtimeConfig.public.firestoreEnabled` to `'true'`.**
> Nitro runs every `NUXT_PUBLIC_*` override through `destr`, so the value
> arrives in `useRuntimeConfig()` as the **boolean** `true` — not the
> string `'true'`. `useRuntimeConfig().public.firestoreEnabled === 'true'`
> therefore silently returns **`false`** on a tenant where Firestore is
> fully enabled and working (`true === 'true'` is false). Use
> `isFirestoreConfigured()` in server code (reads `process.env`), or
> compare against the boolean (`=== true`) on the client. This is the
> same trap documented for `bigqueryEnabled` in
> [bigquery.md](bigquery.md) — it bites every boolean-ish public flag.

## KV (Upstash Redis — legacy BC 1.0 only)

`server/utils/redis.ts` initializes the Upstash Redis client from env vars
that Vercel auto-injects when a KV store is connected:

- `KV_REST_API_URL` — Redis REST API endpoint
- `KV_REST_API_TOKEN` — Auth token

```typescript
import { getRedis, toRedisKey } from '~/server/utils/redis';

const redis = getRedis();
if (redis) {
    await redis.hset(toRedisKey('/users/abc/settings'), { theme: 'dark' });
    const theme = await redis.hget(toRedisKey('/users/abc/settings'), 'theme');
}
```

Returns `null` if KV is not configured (env vars missing). Always check
before using. Note: new BC 2.0 tenants don't get a KV store — the
portal provisions a per-tenant Firestore instead (see above and
[pref.md](pref.md)). The KV utility + `/api/kv/*` routes stay in the
template so legacy BC 1.0 tenants (Convergence, etc.) keep working
unchanged.

For client-side preferences, use the prefs composables
(`useAppPrefs` / `useGlobalPrefs` / `useAppFeaturePrefs` /
`useGlobalFeaturePrefs`) instead of calling KV routes directly —
see [pref.md](pref.md) in this skill. (BC 1.0 KV-backed tenants
reach the same composables; the client picks the right backend
automatically.)

## Postgres (Cloud SQL on BC 2.0, Neon on BC 1.0)

Postgres is provisioned by the portal, not by what's in `.env`. The
**`server/utils/db.ts`** helper is pre-scaffolded and picks the right
transport at runtime — your route code is identical either way:

- **BC 2.0 (GKE-hosted)** — a per-tenant **Cloud SQL** instance, reached
  through the **Cloud SQL Auth Proxy sidecar** that the `aether-ui` Helm
  chart injects. The proxy runs with `--auto-iam-authn` and authenticates
  with the pod's Workload Identity, so the app connects to the proxy on
  `127.0.0.1` as the IAM user with **no password**. The platform injects
  `CLOUD_SQL_CONNECTION_NAME` / `CLOUD_SQL_DATABASE` / `CLOUD_SQL_IAM_USER`
  (+ `CLOUD_SQL_HOST`/`PORT`); `db.ts` reads them. Nothing for you to wire.
- **BC 1.0 / Vercel / local** — a plain `DATABASE_URL` connection string,
  used whenever the `CLOUD_SQL_*` trio is absent.

> **Do NOT** create `server/utils/neon.ts`, `npm install
@neondatabase/serverless`, or `npm install @google-cloud/cloud-sql-connector`.
> The first is the legacy pattern; the connector pulls in
> `google-auth-library`, which the prebuild guard
> (`scripts/check-no-direct-gcp.js`) rejects. Use the pre-scaffolded
> `~/server/utils/db` helper — it only needs `pg`.

### How to check

```typescript
import { isDbConfigured, dbMode } from '~/server/utils/db';
// isDbConfigured() → true when CLOUD_SQL_* or DATABASE_URL is present
// dbMode() → 'cloudsql-proxy' | 'connection-string' | 'none'  (diagnostics)
```

A `true` from `isDbConfigured()` does **not** guarantee the instance is
reachable: Cloud SQL warms up for ~5–15 min after a tenant is created,
and the sidecar takes a few seconds to come up. Always try/catch queries
and render a "warming up" / error state rather than throwing.

**`getDb() === null` and "warming up" are different states** — don't
conflate them (they want different UI):

- `getDb()` returns **`null`** → no transport configured (no Cloud SQL
  on this tenant, or local dev). That's _unconfigured_, not warming up.
- `getDb()` returns a tag but the **query throws** a connection error
  (`ECONNREFUSED` / timeout) → configured but the instance/sidecar isn't
  up yet. That's the real _warming up_ case, and it's only observable
  inside a `try/catch` around the query — not from the null check.

**Local dev:** neither the sidecar nor `DATABASE_URL` is present, so
`getDb()` returns `null`. Handle that gracefully and test against the
deployed build.

### Usage

`server/utils/db.ts` exports `getDb()` (lazy-init, like `getRedis()` in
`redis.ts`): returns a Neon-style tagged-template query function, or
`null` when no transport is configured.

```typescript
import { getDb } from '~/server/utils/db';

export default defineEventHandler(async () => {
    const sql = getDb();
    // null ⇒ no Cloud SQL on this tenant (or local dev) — unconfigured.
    if (!sql) return { state: 'unconfigured', rows: [] };
    try {
        const rows = await sql`SELECT * FROM notes ORDER BY created_at DESC`;
        return { state: 'ok', rows };
    } catch (e) {
        // Connection error ⇒ the instance/sidecar is still warming up.
        // (A SQL error here is a real bug — surface it in dev.)
        return { state: 'warming-up', rows: [], error: String(e) };
    }
});
```

The tagged template binds interpolated values as `$1..$n` parameters, so
`await sql\`SELECT \* FROM notes WHERE id = ${id}\``is injection-safe.
No ORM, no query builder, no pool setup needed (the helper manages a
small`pg.Pool`).

### Creating tables

There is no migrations framework. Use `CREATE TABLE IF NOT EXISTS` directly
in a setup route or at the top of a route that needs the table:

```typescript
const sql = getDb()!;
await sql`CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;
```

Initialize the schema in **one** place — a `server/api/db/setup.post.ts`
route that creates every table (see "Schema ownership" below for why a single
owner matters on multi-identity GKE tenants). For parameterless DDL or
multi-statement schema text, reach for `getSqlRaw()` (exported alongside
`getDb()` from `server/utils/db.ts`) rather than shoehorning it into the
tagged template:

```typescript
import { getSqlRaw } from '~/server/utils/db';
import schema from '~/server/db/schema'; // a .ts module exporting the SQL

export default defineEventHandler(async () => {
    const run = getSqlRaw();
    if (!run) return { state: 'unconfigured' };
    await run(schema); // multi-statement DDL, no params
    return { state: 'ok' };
});
```

> **Keep schema/seed SQL inline — don't read `.sql` files from disk at
> runtime.** The deployed UI runs as a Nitro server _bundle_ in the
> per-tenant GKE cluster (or Cloud Run), and that bundle ships only your
> compiled `server/` code — **not** the rest of the repo tree. A route
> that does `readFileSync('sql/schema.sql')` or
> `readFileSync(join(process.cwd(), 'sql', …))` works under local
> `npm run dev` but throws `ENOENT` / "Cannot read sql/ directory" in the
> deployed container, because there is no `sql/` dir next to the bundle.
> Prefer the inline `CREATE TABLE IF NOT EXISTS` strings above. If you
> genuinely must ship a runtime file (a large seed dataset, a JSON
> fixture, a templated migration), **`import` it as a module** so Vite
> inlines it into the server bundle — there is no runtime file or storage
> indirection left to fail:
>
> ```ts
> // server/api/db/setup.post.ts
> // JSON fixture: import it directly (Vite/Nitro inline JSON).
> import householdFixture from '~/server/data/household-fixture.json';
> // SQL: keep it in a .ts module that exports the string, so it bundles
> // the same way and avoids bundler-specific `?raw` support:
> //   server/db/schema.ts  ->  export default `CREATE TABLE ...;`
> import schema from '~/server/db/schema';
> ```
>
> > ⚠️ **Known issue — do NOT use `nitro.serverAssets` +
> > `useStorage('assets:…')` for this.** The `assets:` storage driver
> > returns `null` at runtime in the deployed GKE bundle even though the
> > asset chunk is present under `.output/server/chunks/raw/`. A direct
> > module `import` (above) always works; `useStorage('kv:…')` (Redis)
> > and `getFirestoreDb()` also work fine — it's specifically the
> > `assets:` driver that's broken in the bundle. (Surfaced on the
> > portfolio-risk smoke test 2026-06-02 as the fix for the earlier
> > "Cannot read sql/ directory" failure, then found broken itself on the
> > portfolio-goals smoke test the same day — the recipe had its own
> > runtime bug.)

### Schema ownership: one owner runs DDL (multi-identity tenants)

> ⚠️ **The UI and the compute job/agent are DIFFERENT Cloud SQL
> principals.** In a BC 2.0 GKE tenant the UI authenticates as
> `bc-aether-ui@<project>.iam` and jobs/agents authenticate as
> `bc-tenant-jobs@<project>.iam` — two distinct Postgres roles, both via
> IAM. Cross-user **data** access (SELECT/INSERT/UPDATE/DELETE) is wired up
> automatically at provision time (ENG-815: a shared `bctenant_app` group
> with group-owned tables), so either identity can read+write the other's
> rows with no manual GRANT.

**Run all DDL from exactly one place.** Put every `CREATE TABLE` /
`CREATE INDEX` / `ALTER` in the UI's `server/api/db/setup.post.ts`, and have
every _other_ identity — the scoring job, agents, and your GET routes —
**only read/write, never issue DDL.** Why:

- It's the simplest mental model and avoids startup races between identities.
- A non-owner running DDL (e.g. a job's `CREATE INDEX IF NOT EXISTS` on a
  UI-created table) historically failed with `42501 must be owner of table`.
  Provisioning since 2026-06-02 makes objects group-owned so this no longer
  crashes — but single-owner is still the pattern to write to.

So **don't** sprinkle `CREATE TABLE IF NOT EXISTS` (or a shared
`ensureTables()` helper) across GET routes or job code. Instead:

**GET routes tolerate a not-yet-created table** (setup may not have run on a
fresh deploy) — match the Postgres error code, don't 500:

```typescript
import { getDb } from '~/server/utils/db';

export default defineEventHandler(async () => {
    const sql = getDb();
    if (!sql) return { state: 'warming-up', rows: [] };
    try {
        const rows = await sql`SELECT * FROM companies ORDER BY updated_at DESC`;
        return { state: 'ok', rows };
    } catch (err: any) {
        // 42P01 undefined_table ⇒ setup hasn't run yet; render empty, not 500.
        if (err.code === '42P01' || err.message?.includes('does not exist')) {
            return { state: 'ok', rows: [] };
        }
        throw err; // a different SQL error is a real bug.
    }
});
```

**The job assumes its tables exist** (the UI's setup route created them) and
only runs DML:

```typescript
// jobs/score_portfolio — DML only, never DDL.
await sql`INSERT INTO entity_scores (neid, score) VALUES (${neid}, ${score})
          ON CONFLICT (neid) DO UPDATE SET score = EXCLUDED.score`;
```

### Lazy-init schema on page load — NOT a user "Init schema" button

"One owner runs DDL via `server/api/db/setup.post.ts`" is an architectural
rule about _which identity_ creates tables — it is **not** a UX instruction.
A surprisingly common misread is to surface a literal **"Initialize schema"
button** the user has to click before the feature works. Don't. The setup
route is `CREATE TABLE IF NOT EXISTS` (idempotent and cheap), so just call it
**for** the user. Two complementary moves make schema setup invisible:

**1. Call `setup` once when the feature page mounts** — fire-and-forget,
before the first read:

```vue
<script setup lang="ts">
    // pages/pulse.vue — ensure the schema exists the instant the page loads.
    onMounted(async () => {
        // Idempotent (CREATE TABLE IF NOT EXISTS); safe to call every mount.
        await $fetch('/api/db/setup', { method: 'POST' }).catch(() => {});
        await loadWatchlist(); // now safe to read
    });
</script>
```

**2. Self-heal your write paths** so a stale tab (open from before the deploy
that added a table) or a first-write-before-mount race still works — catch
`42P01`, run setup, retry once:

```typescript
// server/api/pulse/watchlist.post.ts
import { getDb, getSqlRaw } from '~/server/utils/db';
import schema from '~/server/db/schema';

export default defineEventHandler(async (event) => {
    const sql = getDb();
    if (!sql) return { state: 'unconfigured' };
    const body = await readBody(event);

    async function upsert() {
        await sql!`INSERT INTO watchlist (neid, name) VALUES (${body.neid}, ${body.name})
                   ON CONFLICT (neid) DO UPDATE SET name = EXCLUDED.name`;
    }
    try {
        await upsert();
    } catch (err: any) {
        // 42P01 undefined_table ⇒ setup hasn't run yet. Create + retry ONCE.
        if (err.code === '42P01') {
            await getSqlRaw()!(schema);
            await upsert();
        } else {
            throw err;
        }
    }
    return { state: 'ok' };
});
```

This keeps **all DDL in the one setup module** (the retry calls the same
`schema`), satisfies the single-owner rule, and never makes the user think
about schema. Keep the `/api/db/setup` route itself — it's the canonical DDL
owner and a useful diagnostic — just don't make clicking it a prerequisite.

### Live route and persisted read-back must return the same shape

A feature page often gets the same data from **two** server routes: a **live
compute** route (e.g. a `traverse`/`compute` POST that does fresh work and
returns its result) and a **persisted read-back** GET (the route that backs
page load and the refresh button, reading what was stored). If those two
routes emit **different field names** for the same record, the component
silently breaks on whichever path it isn't tolerating.

The classic bite is a graph/visualization page. The DB columns (and the
read-back GET) use `source_neid` / `target_neid`; the component reads
`e.source_neid`. But the live `traverse` route returns its **internal** shape
(`source` / `target`) straight from an in-memory map. So:

- **after a live traversal** the component gets `source`/`target`, reads
  `e.source_neid` → `undefined` → **edges don't render**;
- **after a refresh** the read-back returns `source_neid`/`target_neid` →
  edges render.

(or the reverse, depending on which shape the component standardised on).
**Nodes mask this** — they key on `neid`, which rarely drifts between the two
routes — so the symptom is the maddening "graph shows nodes but no
connections, and it depends on whether I just ran it or just refreshed."

Fix it at the source: **normalise the live route's response to the persisted
column names** (map `source`→`source_neid` etc. in the route's return), so
both routes hand the component one shape. Don't paper over it by making the
component accept `e.source_neid ?? e.source` — that hides the drift and the
next field will diverge too. The persisted schema is the canonical shape;
make every route that feeds the same component agree with it.

### The helper is pre-scaffolded — don't recreate it

`server/utils/db.ts` ships with the template and handles both transports
(Cloud SQL Auth Proxy on GKE, `DATABASE_URL` elsewhere). Don't write your
own `neon.ts` and don't add `@neondatabase/serverless` or
`@google-cloud/cloud-sql-connector` — the prebuild guard rejects the GCP
connector, and the helper already covers Neon-style `DATABASE_URL` via
`pg`. If `db.ts` is somehow missing, re-run `node init-project.js` or copy
it from the template rather than hand-rolling a Neon client.
