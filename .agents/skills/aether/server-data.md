# Server routes: Elemental API (Query Server)

Server routes reach the Query Server through **`qsFetch()`** in
`~/server/utils/elementalQs` — never by building a `${gatewayUrl}/api/qs/...`
URL by hand. `qsFetch` picks the right transport automatically:

- **`enable_lovelace_apps` tenants** (own in-cluster Query Server): it calls
  the in-cluster serving address directly and authenticates with the shared
  M2M token. The SSR runs in the same cluster, so this is the only path that
  reaches the tenant's own graph.
- **Proxy / Vercel tenants**: it calls the Portal Gateway proxy with the
  `X-Api-Key`, exactly as before.

**Why not hand-build the gateway URL.** On an `enable_lovelace_apps` tenant the
Portal proxy has no upstream configured (`tenant.query_server_url` is blank, by
design — the app talks to its in-cluster QS directly), so the proxy falls back
to the platform **prod** Query Server. A hardcoded `${gatewayUrl}/api/qs/...`
call therefore returns **prod data with a 200** — no error, just the wrong
graph. `qsFetch` is what keeps direct mode working.

**NEVER use `readFileSync('broadchurch.yaml')` in server routes.** The YAML
file is read at build time by `nuxt.config.ts` and its values flow into
`runtimeConfig`. Nitro serverless functions (Vercel) don't bundle arbitrary
project files — `readFileSync` will crash with ENOENT in production even
though it works locally.

```typescript
import { isQsConfigured, qsFetch } from '~/server/utils/elementalQs';

export default defineEventHandler(async () => {
    // Guard and degrade gracefully — covers both direct and proxy tenants.
    if (!isQsConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'Query Server not configured' });
    }

    // Endpoint path only — qsFetch prepends the correct base and attaches auth.
    // Returns the parsed body, already 64-bit-id-safe (see qsParse).
    const res = (await qsFetch('entities/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            queries: [{ queryId: 1, query: 'Microsoft' }],
            maxResults: 5,
            includeNames: true,
        }),
        timeout: 15000,
    })) as any;

    return res;
});
```

Pass the **endpoint path** (e.g. `entities/search`,
`elemental/metadata/schema`, `elemental/entities/properties`,
`entities/{neid}/name`) — not a full URL. `qsFetch` POSTs form bodies too: set
`headers: { 'Content-Type': 'application/x-www-form-urlencoded' }` and pass a
`URLSearchParams().toString()` as `body`.

For common reads, prefer the higher-level helpers in the same module — they
call `qsFetch` under the hood and add schema caching, dedup, and `data_nindex`
name resolution:

| Helper                             | Use for                                                              |
| ---------------------------------- | -------------------------------------------------------------------- |
| `getQsSchema(force?)`              | Schema → `pidByName` / `flavorByName` / `typeByPid` (ids as strings) |
| `getPropertiesByName(neid, names)` | Property values by human name; dedups, resolves references           |
| `findLinkedCount(neid, opts)`      | Count + sample of graph-linked entities                              |
| `resolveEntityNames(neids)`        | Batch NEID → display name                                            |

Drop to `qsFetch` directly only for endpoints the helpers don't cover
(e.g. `entities/search`, flavor-scoped raw schema).

**Browser code must not call the Query Server directly.** A tenant with its
own in-cluster QS is only reachable server-side, and a cross-origin call to the
Portal proxy fails CORS anyway. Have client components fetch a **same-origin
Nitro route** (e.g. `/api/entity/search`) that does the `qsFetch` server-side.

## Surfacing failures honestly — `qsRequest` + envelopes

`qsFetch` returns the parsed body and **throws** on a non-2xx (it's built on
`$fetch`). That's fine for internal enrichment, but it's a trap for
**user-facing** surfaces: a naive `try { await qsFetch(...) } catch { return [] }`
turns a `502 + empty body` (data plane DOWN) into the exact same empty result
as a healthy `200 + empty body` (genuinely no data) — and the UI then renders a
confident, wrong "no data / all clear" state about data that was never fetched.
This is the single most expensive QS footgun (see the Prism build feedback).

For anything a user sees (scoring, dashboards, status panels), use
**`qsRequest()`** instead — it never throws on an HTTP error and hands back the
status alongside the body:

```typescript
import { qsRequest } from '~/server/utils/elementalQs';
import { ready, degraded } from '~/server/utils/envelope';

const r = await qsRequest('prism/scan-news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ neids, window_days: 90 }),
    timeout: 15000,
});

if (!r.ok) {
    // 502 / 503 / network — DATA PLANE DOWN, not "no data". Say so.
    return degraded([], 'upstream_error', `prism/scan-news → ${r.status ?? 'no response'}`, {
        status: r.status,
        endpoint: r.endpoint,
    });
}
return ready(parseRows(r.body)); // r.body may be [] → that's an HONEST empty
```

`qsRequest<T>()` → `{ ok, status, body, endpoint, error, durationMs }`:

| Result                                 | Meaning                                        |
| -------------------------------------- | ---------------------------------------------- |
| `ok: true, status: 200, body: <data>`  | real data                                      |
| `ok: true, status: 200, body: null/[]` | reachable, genuinely no data (honest empty)    |
| `ok: false, status: 502`               | data plane down — surface as an infra error    |
| `ok: false, status: null`              | network/transport failure (or QS unconfigured) |

The `AetherEnvelope<T>` shape (`ready()` / `degraded()` from
`~/server/utils/envelope`) is the **shared convention** for a route that can
legitimately return partial/empty/degraded data — `state` is one of
`ready | warming | unconfigured | capability_missing | upstream_error`. Return
it from any QS-backed route so the client can tell "ready" from "reachable but
not there yet" without every app inventing its own flags. On the client,
`usePlatformStatus()` / `<PlatformStatusBanner :include="['prism','galaxy']" />`
probe `GET /api/platform/status` and render failing endpoints (with HTTP codes)
honestly — drop the banner on a page instead of hand-rolling one.

Runtime config keys read by `elementalQs` (you normally don't touch these
directly — `qsFetch` does):

| Key                  | Source                                                  | Purpose                                                                              |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `gatewayUrl`         | `broadchurch.yaml` → `gateway.url`                      | Portal Gateway base URL (proxy mode)                                                 |
| `tenantOrgId`        | `broadchurch.yaml` → `tenant.org_id`                    | Tenant org id for the proxy path                                                     |
| `qsApiKey`           | `broadchurch.yaml` → `gateway.qs_api_key`               | API key sent as `X-Api-Key` (proxy)                                                  |
| `queryServerAddress` | `query_server.url` / `NUXT_PUBLIC_QUERY_SERVER_ADDRESS` | In-cluster QS address; a `*.svc.cluster.local` URL switches `qsFetch` to direct mode |

See [data.md](data.md) in this skill for endpoint reference and response shapes.
