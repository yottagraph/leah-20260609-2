# Galaxy & Prism — batch reads over the in-memory graph

`galaxy` and `prism` are a **second Query Server REST surface** built for
**portfolio-scale batch reads**. Where the endpoints in [`data.md`](data.md)
(`/elemental/find`, `getPropertyValues`, `/entities/*`) answer "tell me about
_this_ entity," galaxy and prism answer "tell me about _these 50–500_ entities
in one call" — no per-entity fanout.

Both are served by the **same Query Server, same host, same auth** as the rest
of the QS REST API. You reach them through the Portal Gateway proxy exactly
like everything else: `{gateway.url}/api/qs/{tenant.org_id}/...` with the
`X-Api-Key` header. The `utils/elementalHelpers` and `server/utils/elementalQs`
helpers from `data.md` work unchanged — `buildGatewayUrl('prism/scan-events')`
builds the right URL.

> **When to reach for this surface:** you have a known set of NEIDs (a
> watchlist, a portfolio, the neighbors you just fetched) and you want one
> property/relationship/market slice across all of them. If you're looking up
> a single entity, or discovering entities you don't have NEIDs for yet, stay
> on the `data.md` path (`findEntities` / `getPropertyValues` / MCP).

## Availability — probe the surface, don't trust `/status`

**Determine whether galaxy/prism is up by probing the surface itself, not by
reading the QS `/status` capability list.** Galaxy and prism are served by a
separate `graph-query` backend that sits behind the same host as the rest of
the QS REST API (Caddy routes `/galaxy/*` and `/prism/*` there). The `/status`
endpoint — and the `capabilities` array on `getStatus()` — is answered by the
**main `query` service**, which does **not** advertise `galaxy`/`prism` even
when those endpoints are fully working. An agent that gates on
`capabilities.includes("galaxy")` will wrongly conclude the surface is
unavailable and refuse to use it. Don't do that.

Instead, probe a cheap real endpoint and classify the actual response:

```bash
curl -s -o /dev/null -w '%{http_code}' "$GW/api/qs/$ORG/prism/schema" -H "X-Api-Key: $KEY"
# or: .../galaxy/stats
```

| Code  | Meaning                                             | What to do                                             |
| ----- | --------------------------------------------------- | ------------------------------------------------------ |
| `200` | Surface is live                                     | Use it.                                                |
| `503` | Backend up but the in-memory index is still warming | Treat as "warming up" — retry later, surface honestly. |
| `502` | `graph-query` restarting / briefly unreachable      | Transient — retry; don't hard-disable the feature.     |
| `404` | `galaxy` capability genuinely not enabled here      | Surface really is off for this tenant (rare on prod).  |

This is the same "probe the endpoint, don't infer health from a secondary
signal" rule as [`data.md`](data.md) § "Before you 'fix' an apparent platform
outage." The `/status` capability list is exactly such a secondary signal, and
it is known to under-report this surface — so a status chip for galaxy/prism
should be driven by an actual probe (or simply by whether the QS key is wired),
never by the advertised capability list.

> **Capture the HTTP status — a `502 + empty body` is NOT "no data."** From a
> Nitro route, call these lenses with **`qsRequest()`** (status-preserving), not
> `qsFetch()` (which throws and discards the status) or a bare `$fetch`. A
> `502`/`503` with an empty body must surface as a data-plane issue, never get
> swallowed into an empty result that the UI renders as a confident "all clear."
> See [`server-data.md`](server-data.md) § "Surfacing failures honestly" and the
> `<PlatformStatusBanner :include="['prism','galaxy']" />` it documents.

## Wire conventions (apply to both)

These mirror the opaque-string ID rule in [`data.md`](data.md#the-opaque-string-id-rule--neids-eids-pids-and-fids-are-strings-never-numbers)
— carry every identifier as a string, never a JS number.

- **NEID** — entity id, a **20-digit zero-padded decimal string**
  (`"00000000000000012345"`). The underlying `int64` exceeds 2^53, so it is
  never a JSON number. Pad raw relationship ids with `padNeid()` before
  sending them back.
- **PID / FID** — property / flavor index, also **decimal strings**. Get them
  from `GET /prism/schema` (or the normal schema endpoints) and pass them back
  verbatim.
- **Galaxy** is all `GET` (path + query params). **Prism** is all `POST` with a
  JSON body, **except `GET /prism/schema`**.
- Timestamps are RFC3339. Prism lookback windows are `window_days` (int); omit
  or pass `<=0` to take the per-lens default.
- Prism: empty `neids` → `400`.

---

## Galaxy — primitive graph reads

Galaxy exposes the raw in-memory index: an entity's neighbors, its quads
(statements), per-flavor membership, and index stats. It's the lower-level
surface — useful when you want graph structure directly rather than a curated
lens. All endpoints are `GET`.

| Endpoint                                | Params                                         | Returns                                                                                                           |
| --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /galaxy/{neid}/neighbors`          | `size` (optional cap)                          | `{ neighbors: NEID[], weights: float[] }` — neighbors sorted by link frequency, `weights` parallel to `neighbors` |
| `GET /galaxy/{neid}/local-neighborhood` | `size` (markov neighborhood size)              | `{ neighbors: NEID[] }` — markov-approximated neighborhood, always includes the center                            |
| `GET /galaxy/{neid}/quads`              | —                                              | `{ quads: GalaxyQuad[] }` — every statement about the entity (insertion order)                                    |
| `GET /galaxy/{neid}/info`               | —                                              | `{ neid, name, flavor, findex, num_quads }` — lightweight metadata                                                |
| `GET /galaxy/properties/{pid}/quads`    | `neid` (repeatable; scopes to source entities) | `{ quads: GalaxyQuad[] }` — property-centric quad query                                                           |
| `GET /galaxy/flavors/{flavor}/entities` | —                                              | `{ entities: NEID[] }` — all entities of a flavor (order not guaranteed)                                          |
| `GET /galaxy/stats`                     | —                                              | `{ num_entities, num_flavors, total_num_quads, flavor_counts }`                                                   |

A **`GalaxyQuad`** is one knowledge-graph statement:

```json
{
    "source": "00000000000000012345",
    "property": "competes_with",
    "pid": 42,
    "destination": "...",
    "dest_type": "relational",
    "time": "2026-01-02T00:00:00Z"
}
```

`source` is the source NEID, `property` is the human-readable name, `pid` is
its id, and `time` is the observation timestamp. **`destination` is interpreted
by `dest_type`:** `"relational"` → a target NEID (20-digit string),
`"numerical"` → a stringified float64, `"categorical"` → a resolved label.

> **Don't assume hop _depth_ when you walk quads.** Discovery-first means
> reading the `property` names you actually observe at each node and following
> them — not just at the first hop. A relationship you think of as one hop may
> be **reified** into an intermediate entity that carries the qualifiers as
> properties: e.g. `portfolio --has_position--> position --of_security-->
instrument`, where `position` holds `portfolio_weight` / `asset_class` /
> `asset_strategy`. If a node's quads point into an intermediate entity instead
> of your expected target, follow the chain (read the intermediate's quads,
> then its outbound relational quad). See `data.md` § "Reified relationships"
> for the full pattern and why per-edge attributes aren't the carrier here.

Example — neighbors of an entity through the gateway:

```typescript
import { buildGatewayUrl, getApiKey } from '~/utils/elementalHelpers';

const res = await $fetch<{ neighbors: string[]; weights: number[] }>(
    buildGatewayUrl(`galaxy/${neid}/neighbors?size=10`),
    { headers: { 'X-Api-Key': getApiKey() } }
);
// res.neighbors[i] is a NEID; res.weights[i] is its link frequency
```

```bash
# curl equivalent (read GW/ORG/KEY from broadchurch.yaml — see data.md)
curl -s "$GW/api/qs/$ORG/galaxy/stats" -H "X-Api-Key: $KEY" | jq .
```

---

## Prism — curated Layer-2 lenses + composed bundles

Prism sits one level above galaxy: each endpoint is a **lens** that returns a
typed, analysis-ready slice (sanctions, fundamentals, filings, events,
governance, news, market, ownership) across a whole NEID set in one call. There
are two kinds:

1. **Thin lenses** — ten one-to-one endpoints, your batch primitives. They
   return the whole portfolio's data in one call but with **bare NEIDs and no
   names** — you resolve names yourself (batch them via `POST /entities/names`,
   `{ neids } -> { results: { [neid]: name } }`).
2. **Bundles** — five higher-level endpoints that compose lenses server-side,
   used where there's a real win (aggregation, or inlined name/identity
   resolution over a fanned-out NEID set). These collapse N+1 fanout patterns.

### Thin lenses (one `POST` per lens)

| Endpoint                              | Body                                        | Returns                                                                                                      | Default window      |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| `POST /prism/entity-sanctions`        | `{neids}`                                   | per-org sanctions facts (topics, list_ids, sectors, source_urls, start_date)                                 | —                   |
| `POST /prism/scan-fundamentals`       | `{neids, window_days?}`                     | per-org ≤2 latest values per fundamentals key                                                                | ~18 mo              |
| `POST /prism/scan-filings`            | `{neids, window_days?}`                     | filing records (`{neid, filing, time, form_type}`) + coverage                                                | 365 d               |
| `POST /prism/scan-events`             | `{neids, window_days?}`                     | event records (`{neid, event, time, event_type, category, description}`) + coverage                          | 730 d               |
| `POST /prism/scan-governance`         | `{neids}`                                   | officer/director roster with current/departed status                                                         | —                   |
| `POST /prism/scan-news`               | `{neids, window_days?}`                     | three flat quad slices (relational / categorical / numerical)                                                | 90 d                |
| `POST /prism/scan-market`             | `{neids}`                                   | per-org market scalars (return_30d, volatility_30d, rsi_14, market_anomaly)                                  | —                   |
| `POST /prism/disambiguate-instrument` | `{neids}`                                   | per-org canonical instrument (`{neid, instrument, ticker, exchange, currency, sector, industry}`) + coverage | —                   |
| `POST /prism/ohlcv-series`            | `{neids, window_days?}`                     | per-instrument daily OHLCV bars + coverage                                                                   | 90 d                |
| `POST /prism/ownership-traversal`     | `{neids, max_hops?, max_results_per_seed?}` | per-seed BFS nodes (`{neid, hop, parent, ownership_percent, jurisdiction}`) + coverage                       | hops=3, perSeed=100 |

Every lens wraps its rows under a **top-level envelope key** — the "Returns"
column above is the _row_ shape, not the envelope. Destructure the wrapper
first (shapes below verified against the live server):

| Endpoint                  | Top-level shape                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity-sanctions`        | `{ per_org: [{ neid, topics[], list_ids[], sectors[], source_urls[], start_date }], coverage: NEID[] }`                                                                                       |
| `scan-fundamentals`       | `{ per_org: [{ neid, assets, liabilities, equity, net_income, current_assets, current_liabilities, operating_income, debt_due_18m, … }] }` — each key an array of `{ property, value, time }` |
| `scan-filings`            | `{ records: [{ neid, filing, time, form_type }], coverage: NEID[] }`                                                                                                                          |
| `scan-events`             | `{ records: [{ neid, event, time, event_type, category, description }], coverage: NEID[] }`                                                                                                   |
| `scan-governance`         | `{ records: [{ neid, person, role, title, status, first_seen, latest_seen, org_most_recent_filing }] }`                                                                                       |
| `scan-news`               | `{ relational_quads: [], categorical_quads: [], numerical_quads: [] }`                                                                                                                        |
| `scan-market`             | `{ per_org: [{ neid, return_30d, volatility_30d, rsi_14, market_anomaly }] }` (empty when scalars absent)                                                                                     |
| `disambiguate-instrument` | `{ per_org: [{ neid, instrument, ticker, exchange, currency, sector, industry }], coverage: NEID[] }`                                                                                         |
| `ohlcv-series`            | `{ per_instrument: [{ … }], coverage: NEID[] }`                                                                                                                                               |
| `ownership-traversal`     | `{ per_seed: [{ seed, nodes: [{ neid, hop, parent, ownership_percent, jurisdiction }] }], coverage: NEID[] }`                                                                                 |

`coverage` is the subset of input NEIDs that returned data. String/numeric
fields are omitted or come back empty (`""`) when the underlying property is
absent — don't assume every documented field is present on every row.

Data caveats (non-blocking):

- `scan-market` reads scan-time scalars (`return_30d`, `volatility_30d`,
  `rsi_14`, `market_anomaly`); **many tenants don't carry those properties, so
  it comes back all-empty/NULL** and a column you snapshot from it will be
  perpetually NULL. **If you want a market signal that actually populates,
  START with `stock-bundle` (or `ohlcv-series`)** — reach for `scan-market`
  only once you've confirmed this tenant has the scan-time scalars. An empty
  `scan-market` is a correct result on a tenant without them, not a bug;
  surface it honestly rather than faking the metric.
- `disambiguate-instrument` (and `stock-bundle`, which builds on it) is a
  ~80%-accurate price-density heuristic — treat its `instrument` as
  canonical-but-fallible. It misfires even on megacaps: a live `stock-bundle`
  call for **Microsoft** resolved the instrument to **"Nasdaq, Inc." (NDAQ)**.
  Don't key business logic off it without a sanity check.

### Resolving names — `POST /entities/names` (one call, the batch counterpart)

Thin lenses return **bare NEIDs, no names**. Resolve the whole set in **one
call** — do NOT loop `GET /entities/{neid}/name` per NEID (that's the
per-entity fanout this surface exists to kill; the `resolveEntityNames`
helper in [`data.md`](data.md) does that GET loop and is the wrong tool at
portfolio scale).

```
POST /entities/names
body:  { "neids": ["00000000000000012345", ...] }   // 20-digit strings
->     { "results": { "00000000000000012345": "Microsoft Corporation", ... } }
```

```typescript
import { buildGatewayUrl, getApiKey, padNeid } from '~/utils/elementalHelpers';

const { results } = await $fetch<{ results: Record<string, string> }>(
    buildGatewayUrl('entities/names'),
    {
        method: 'POST',
        headers: { 'X-Api-Key': getApiKey(), 'Content-Type': 'application/json' },
        body: { neids: portfolio.map(padNeid) },
    }
);
const name = results[neid]; // undefined if that NEID didn't resolve — guard it
```

```bash
curl -s "$GW/api/qs/$ORG/entities/names" \
  -X POST -H "Content-Type: application/json" -H "X-Api-Key: $KEY" \
  -d '{"neids":["00000000000000012345"]}' | jq .
```

`results` is keyed by the input NEID; NEIDs with no resolvable name are simply
**absent** from the map (not `null`) — always guard with `results[neid] ?? neid`
or similar. This is the same `entities/names` endpoint referenced throughout
this doc — it's a regular QS REST path (no `/elemental/` prefix), reached
through the gateway like every other call here. (Verified live: a compute job
resolved Microsoft / Tesla / NetApp through this single call.)

### Bundles (server-side composition)

#### `GET /prism/schema` — live vocabulary dump

The PID/FID vocabulary of the **loaded in-memory snapshot**. Resolve your own
logical-key aliases against it client-side, then pass the resolved ids back
into bundle requests.

```jsonc
// GET /prism/schema  ->
{
  "properties": [ { "pid": "42", "name": "subsidiary_of", "type": "relational" }, ... ],
  "flavors":    [ { "fid": "7",  "name": "organization" }, ... ]
}
```

`type` is `"numerical" | "categorical" | "relational"`. Properties sorted by
PID, flavors by FID. These are the exact ids the lenses understand — the only
ones you should feed back into `/prism/*` requests.

> This is **not** the DB-backed `/schema` from `data.md`. `/prism/schema`
> reflects the live in-memory index the lenses run against; use it for anything
> you intend to pass back to a prism endpoint.

#### `POST /prism/cik-velocity-bundle` — quarter-bucketed event counts

Server-side aggregation that shrinks the payload to ~16 ints per entity instead
of a multi-year event stream.

```jsonc
// POST  { "neids": [...], "quarters": 16 }   // quarters<=0 -> 16
// ->
{ "bundles": [
  { "neid": "...",
    "quarter_counts": { "2025-Q1": 4, "2025-Q2": 1, ... },  // missing key = 0
    "latest_quarter": "2025-Q3", "prev_quarter": "2025-Q2" } ] }
```

#### `POST /prism/relationship-universe` — typed neighbors, names inlined

The biggest win and the one bundle **not expressible** with the thin lenses:
1-hop typed neighbors with names resolved server-side and the labeled edge list
in one call (replaces the 5N edge-finds + ≤80N name-lookup fanout). You define
the neighbor classes (the taxonomy is yours) as resolved relational PIDs +
direction.

```jsonc
// POST
{ "neids": ["...portfolio..."],
  "classes": [
    { "name": "companies",   "pindexes": ["42","43"], "direction": "outgoing" },
    { "name": "people",      "pindexes": ["88","89"], "direction": "incoming" },
    { "name": "locations",   "pindexes": ["55"] }                 // default "both"
  ] }
// ->
{ "classes": [
    { "name": "companies",
      "nodes": [ { "neid": "...", "name": "Acme Subsidiary Ltd",
                   "connects_to": ["...seed1..."] }, ... ] }, ... ],
  "edges":  [ { "source": "...seed...", "target": "...neighbor...",
                "relationship": "subsidiary_of" }, ... ] }
```

Non-relational or unknown PIDs are silently dropped. v1 is `hop_depth=1`.

#### `POST /prism/acs-bundle` — ownership chain + screening, names inlined

`OwnershipTraversal` with node names and jurisdiction inlined, plus an optional
screening list resolved once for the whole request.

```jsonc
// POST  { "neids": [...], "max_depth": 3, "screening_findex": "19" }  // findex optional
// ->
{ "per_seed": [
    { "seed": "...",
      "traversal": [ { "neid": "...", "name": "HoldCo SA", "hop": 1,
                       "parent": "...", "ownership_percent": 75.0,
                       "jurisdiction": "LU" }, ... ] } ],
  "screening_list_neids": ["...", "..."],   // present only if screening_findex given
  "screening_list_source": "sanctioned_entity" }
```

Traversal is org-flavor-filtered. Resolve `screening_findex` from
`/prism/schema` (the flavor whose name matches your screening list).

#### `POST /prism/stock-bundle` — disambiguate + OHLCV, fused

One call per **org**: the server disambiguates each org to its instrument,
fetches OHLCV, and labels coverage — removing the sequential
disambiguate-then-fetch round trip.

```jsonc
// POST  { "neids": [...orgs...], "window_days": 90 }
// ->
{ "bundles": [
    { "neid": "...org...",
      "instrument": { "neid": "...", "name": "Acme Corp Common", "ticker": "ACME",
                      "exchange": "NASDAQ", "currency": "USD",
                      "sector": "...", "industry": "..." },   // null if none linked
      "ohlcv": [ { "date": "...", "open": 1, "high": 2, "low": 0.5,
                   "close": 1.5, "volume": 1000 }, ... ],
      "coverage": "full" } ] }   // "full" >=5 bars, "partial" 1-4, "none" 0
```

### Calling prism from an aether app

Same gateway + helpers as the rest of the QS REST surface.

```typescript
import { buildGatewayUrl, getApiKey, padNeid } from '~/utils/elementalHelpers';

// One batched call replaces a per-entity loop. Note the envelope key is
// `records` (not `events`) — see the response-envelope table above.
const { records, coverage } = await $fetch<{ records: any[]; coverage: string[] }>(
    buildGatewayUrl('prism/scan-events'),
    {
        method: 'POST',
        headers: { 'X-Api-Key': getApiKey(), 'Content-Type': 'application/json' },
        body: { neids: portfolio.map(padNeid), window_days: 730 },
    }
);
```

```bash
# curl — schema dump then a thin lens
curl -s "$GW/api/qs/$ORG/prism/schema" -H "X-Api-Key: $KEY" | jq '.flavors[:3]'

curl -s "$GW/api/qs/$ORG/prism/scan-fundamentals" \
  -X POST -H "Content-Type: application/json" -H "X-Api-Key: $KEY" \
  -d '{"neids":["00000000000000012345"],"window_days":540}' | jq .
```

### Migration shape (replacing per-entity fanout)

When porting code that loops over entities (e.g. one MCP/REST call per CIK):

1. **Bootstrap the vocabulary once.** Replace hardcoded pid/flavor constants
   with a single cached `GET /prism/schema`; map your logical-key aliases
   (`"owners" -> ["beneficial_owner_of", ...]`) to concrete PIDs from the dump.
2. **Thin lenses: one batched call, then resolve names.** A per-entity loop
   becomes a single `POST /prism/scan-*`; batch names for bare-NEID output via
   `POST /entities/names` rather than one-at-a-time lookups.
3. **Heavy composed views: call the bundle, delete the fanout.** The
   relationship view, ownership chain, event bucketing, and
   disambiguate-then-fetch each collapse to one bundle call with names already
   inlined.
4. **Keep citations/provenance on MCP.** This JSON surface deliberately carries
   NEIDs and facts, not provenance snippets — keep the MCP path (see
   [`data.md`](data.md)) for those.

### Quick reference

```
GET  /prism/schema
POST /prism/entity-sanctions          {neids}
POST /prism/scan-fundamentals         {neids, window_days?}
POST /prism/scan-filings              {neids, window_days?}
POST /prism/scan-events               {neids, window_days?}
POST /prism/scan-governance           {neids}
POST /prism/scan-news                 {neids, window_days?}
POST /prism/scan-market               {neids}
POST /prism/disambiguate-instrument   {neids}
POST /prism/ohlcv-series              {neids, window_days?}
POST /prism/ownership-traversal       {neids, max_hops?, max_results_per_seed?}
POST /prism/cik-velocity-bundle       {neids, quarters?}
POST /prism/relationship-universe     {neids, classes:[{name, pindexes:[pid], direction?}]}
POST /prism/acs-bundle                {neids, max_depth?, screening_findex?}
POST /prism/stock-bundle              {neids, window_days?}
```

The full machine-readable contract (every field, every type) is the OpenAPI
spec the **elemental-api skill** (`.agents/skills/elemental-api/`) is generated
from — point client-gen at that for typed bindings.
