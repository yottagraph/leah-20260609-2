/**
 * Server-side Query Server (Elemental REST) helpers — the higher-level
 * enrichment primitives a Nitro route actually needs.
 *
 * `~/utils/elementalHelpers` (client/composable side) gives you the
 * gateway URL + headers + a name search + a single name lookup. That's
 * enough to *look* authoritative and not enough to *build* a real
 * server-side enrichment route on — every app ends up re-deriving schema
 * caching, the form-encoded `getPropertyValues` call, the
 * "multiple rows per (eid, pid)" dedup, `data_nindex` → name resolution,
 * and (the silent killer) 64-bit-safe PID/NEID handling. This module
 * does all of that once, correctly.
 *
 * Pair it with `callAgent()` (resolution via the agent + Elemental MCP)
 * for the canonical BC 2.0 "resolve → enrich → persist" flow: the agent
 * resolves a name to a NEID, then these helpers fetch the deterministic
 * graph facts about that exact NEID.
 *
 *   const { values } = await getPropertiesByName(neid, ['country', 'industry']);
 *   const { count, sampleNeids } = await findLinkedCount(neid);
 *
 * All IDs (NEID / EID / PID / FID) are treated as OPAQUE STRINGS, never
 * JS numbers — see `getQsSchema()` and `qsParse()` below for why that's
 * non-negotiable (JSON.parse silently rounds 64-bit ids past 2^53,
 * including large negatives, and the rounded id then returns empty with
 * no error). Auto-imported in server routes (Nitro auto-imports
 * `server/utils`); an explicit import also works.
 */

interface QsConfig {
    base: string; // proxy: `${gatewayUrl}/api/qs/${orgId}`; direct: the in-cluster serving address
    apiKey: string;
    // true = direct in-cluster call (M2M bearer); false = Portal proxy (X-Api-Key)
    direct: boolean;
}

/** Schema property/flavor, with all ids kept as strings. */
export interface QsSchema {
    /** property name → { pid, type } (e.g. 'country' → { pid: '313', type: 'data_nindex' }) */
    pidByName: Map<string, { pid: string; type: string }>;
    /** flavor (entity-type) name → fid (e.g. 'organization' → '12') */
    flavorByName: Map<string, string>;
    /** pid → type, for deciding when a value is an entity reference */
    typeByPid: Map<string, string>;
}

export interface EntityProperties {
    /**
     * property name → display value. `data_nindex` references are resolved
     * to the linked entity's name; scalars are returned as strings (the QS
     * wire contract — see the bigquery skill's "scalars round-trip as
     * strings"). `null` = the entity has no value for that property.
     */
    values: Record<string, string | null>;
    /**
     * property name → raw value string BEFORE nindex resolution (a padded
     * 20-char NEID for references, the same string as `values` otherwise).
     */
    raw: Record<string, string | null>;
    /** Requested names that aren't in the schema (typo / wrong tenant). */
    unknownProps: string[];
}

export interface LinkedResult {
    /** Number of linked entities returned (capped by `limit`). */
    count: number;
    /** Up to `sampleSize` linked NEIDs (zero-padded to 20 chars). */
    sampleNeids: string[];
}

// True when the QS should be called directly (SSR → in-cluster serving address +
// M2M bearer) rather than through the Portal proxy: an in-cluster
// `*.svc.cluster.local` address, or an explicit `queryServerDirect` override.
export function isQsDirect(): boolean {
    const pub = (useRuntimeConfig().public ?? {}) as Record<string, unknown>;
    const addr = String(pub.queryServerAddress ?? '');
    if (!addr) return false;
    const explicit = pub.queryServerDirect === true || pub.queryServerDirect === 'true';
    return explicit || /\.svc(\.cluster\.local)?(:\d+)?\/?$/.test(addr);
}

/** Whether the QS is reachable — direct in-cluster, or via the Portal proxy (gateway + org + key). */
export function isQsConfigured(): boolean {
    const pub = (useRuntimeConfig().public ?? {}) as Record<string, unknown>;
    return isQsDirect() || Boolean(pub.gatewayUrl && pub.tenantOrgId && pub.qsApiKey);
}

function qsConfig(): QsConfig {
    const pub = (useRuntimeConfig().public ?? {}) as Record<string, string>;

    // Direct: target the in-cluster address; the M2M bearer is attached in qsFetch.
    if (isQsDirect()) {
        return { base: pub.queryServerAddress.replace(/\/$/, ''), apiKey: '', direct: true };
    }

    const gatewayUrl = pub.gatewayUrl;
    const orgId = pub.tenantOrgId;
    const apiKey = pub.qsApiKey;
    if (!gatewayUrl || !orgId || !apiKey) {
        throw createError({
            statusCode: 503,
            statusMessage:
                'Query Server not configured (gatewayUrl / tenantOrgId / qsApiKey missing). ' +
                'Guard server routes with isQsConfigured() and degrade gracefully.',
        });
    }
    return { base: `${gatewayUrl}/api/qs/${orgId}`, apiKey, direct: false };
}

/**
 * Fetch a QS endpoint as TEXT and JSON-parse it WITHOUT corrupting 64-bit
 * ids. `pid` / `fid` / `findex` / `eid` / `value` numeric fields are
 * rewritten to quoted strings before `JSON.parse`, so an id like
 * `-5294792805565584640` survives intact. A plain `$fetch` (which parses
 * JSON eagerly) would round it to `-5294792805565585000` and the
 * downstream query would return empty with no error — the single most
 * common "the data doesn't exist" false alarm.
 */
export async function qsFetch(
    endpoint: string,
    init: {
        method?: string;
        body?: BodyInit;
        headers?: Record<string, string>;
        timeout?: number;
    } = {}
): Promise<unknown> {
    const { base, apiKey, direct } = qsConfig();
    // Direct: M2M bearer; proxy: the QS proxy's X-Api-Key.
    let authHeaders: Record<string, string> = { 'X-Api-Key': apiKey };
    if (direct) {
        const token = await getM2mToken();
        authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    }
    const text = await $fetch<string>(`${base}/${endpoint.replace(/^\//, '')}`, {
        method: (init.method as any) ?? 'GET',
        headers: { ...authHeaders, ...(init.headers ?? {}) },
        body: init.body,
        responseType: 'text',
        timeout: init.timeout,
    });
    return qsParse(text);
}

/** Quote 64-bit-risky integer fields, then JSON.parse. Exported for tests/edge use. */
export function qsParse(text: string): unknown {
    // The trailing `(?![\d.eE])` is essential. `value` is overloaded on the
    // QS wire: for a relational property it's an NEID (must stay a string),
    // but for a NUMERICAL property it's a real measurement that can arrive
    // as a bare float (e.g. portfolio_weight `0.0006457615408`). Without the
    // lookahead, the greedy `(-?\d+)` quotes only the integer part —
    // `"value":"0".0006…` — which is invalid JSON, so JSON.parse throws and
    // the caller silently gets `[]`. We only ever want to quote COMPLETE
    // integer tokens (the 64-bit-risky ids); floats must pass through
    // untouched so a single numerical property can't break a whole batch.
    const safe = text.replace(
        /"(pid|fid|findex|eid|value)"\s*:\s*(-?\d+)(?![\d.eE])/g,
        '"$1":"$2"'
    );
    return JSON.parse(safe);
}

/** Status-preserving result of a QS call. `status: null` means no HTTP response
 *  (network / transport failure or QS unconfigured). */
export interface QsResult<T = unknown> {
    /** HTTP 2xx. */
    ok: boolean;
    /** HTTP status, or null when there was no response. */
    status: number | null;
    /** 64-bit-safe parsed body; null on empty body, non-2xx, or parse failure. */
    body: T | null;
    endpoint: string;
    /** Short error text on non-2xx / network / parse failure; null on success. */
    error: string | null;
    durationMs: number;
}

/**
 * Status-preserving QS request. Unlike `qsFetch` — which returns just the
 * parsed body and THROWS on a non-2xx (via `$fetch`) — this NEVER throws on an
 * HTTP error. It hands back the status alongside the body so callers can tell
 * apart the states every QS-backed *user-facing* surface must distinguish:
 *
 *   { ok: true,  status: 200, body: <data> }  → real data
 *   { ok: true,  status: 200, body: null }    → reachable, genuinely no data (honest empty)
 *   { ok: false, status: 502, body: null }    → data plane down — surface as an infra error
 *   { ok: false, status: null }               → network/transport failure (or QS unconfigured)
 *
 * The footgun this exists to kill: a naive `await $fetch(url)` swallows a
 * `502 + empty body` as `null`, the caller treats it as "no data", and the UI
 * confidently renders a healthy-looking empty/zero state about data that was
 * never actually fetched. Use `qsRequest` for scoring/dashboards/status
 * banners; keep `qsFetch` for internal enrichment where a thrown error is fine.
 */
export async function qsRequest<T = unknown>(
    endpoint: string,
    init: {
        method?: string;
        body?: BodyInit;
        headers?: Record<string, string>;
        timeout?: number;
    } = {}
): Promise<QsResult<T>> {
    const t0 = Date.now();
    const ep = endpoint.replace(/^\//, '');
    const done = (r: Omit<QsResult<T>, 'endpoint' | 'durationMs'>): QsResult<T> => ({
        ...r,
        endpoint: ep,
        durationMs: Date.now() - t0,
    });

    let cfg: QsConfig;
    try {
        cfg = qsConfig();
    } catch (e: any) {
        return done({
            ok: false,
            status: null,
            body: null,
            error: e?.statusMessage || e?.message || 'qs_not_configured',
        });
    }

    let authHeaders: Record<string, string> = { 'X-Api-Key': cfg.apiKey };
    if (cfg.direct) {
        const token = await getM2mToken();
        authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    }

    try {
        const res = await fetch(`${cfg.base}/${ep}`, {
            method: init.method ?? 'GET',
            headers: { ...authHeaders, ...(init.headers ?? {}) },
            body: init.body,
            signal: init.timeout ? AbortSignal.timeout(init.timeout) : undefined,
        });
        const text = await res.text();
        if (!res.ok) {
            return done({
                ok: false,
                status: res.status,
                body: null,
                error: text ? text.slice(0, 200) : `HTTP ${res.status}`,
            });
        }
        let parsed: T | null = null;
        if (text) {
            try {
                parsed = qsParse(text) as T;
            } catch (e) {
                return done({
                    ok: false,
                    status: res.status,
                    body: null,
                    error: `parse_error: ${String(e).slice(0, 160)}`,
                });
            }
        }
        return done({ ok: true, status: res.status, body: parsed, error: null });
    } catch (e: any) {
        return done({
            ok: false,
            status: null,
            body: null,
            error: String(e?.message || e).slice(0, 200),
        });
    }
}

/** Pad a raw numeric entity id to a valid 20-char NEID string. */
export function padNeid(value: string | number): string {
    return String(value).padStart(20, '0');
}

let schemaCache: QsSchema | null = null;

/**
 * Schema discovery with in-process caching, returning name→id maps with
 * every id kept as a string. Use the maps to turn human property names
 * ('country') into the numeric PIDs the QS expects — never hardcode PIDs.
 */
export async function getQsSchema(force = false): Promise<QsSchema> {
    if (schemaCache && !force) return schemaCache;
    const res = (await qsFetch('elemental/metadata/schema')) as any;
    const properties: any[] = res?.schema?.properties ?? res?.properties ?? [];
    const flavors: any[] = res?.schema?.flavors ?? res?.flavors ?? [];

    const pidByName = new Map<string, { pid: string; type: string }>();
    const typeByPid = new Map<string, string>();
    for (const p of properties) {
        const pid = String(p?.pid ?? p?.id ?? '');
        const name = String(p?.name ?? '');
        const type = String(p?.type ?? p?.datatype ?? '');
        if (!pid || !name) continue;
        if (!pidByName.has(name)) pidByName.set(name, { pid, type });
        typeByPid.set(pid, type);
    }

    const flavorByName = new Map<string, string>();
    for (const f of flavors) {
        const fid = String(f?.fid ?? f?.findex ?? '');
        const name = String(f?.name ?? '');
        if (fid && name && !flavorByName.has(name)) flavorByName.set(name, fid);
    }

    schemaCache = { pidByName, flavorByName, typeByPid };
    return schemaCache;
}

/**
 * Fetch property values for one entity by human property NAMES.
 *
 * Resolves names → PIDs via the schema, issues the form-encoded
 * `getPropertyValues` call with a string-interpolated `pids` array
 * (so big/negative PIDs survive), DEDUPES the response (the endpoint
 * returns one row per (eid, pid, efid) source — often many identical
 * rows; we take first-wins), and resolves any `data_nindex` reference
 * values to the linked entity's display name.
 */
export async function getPropertiesByName(
    neid: string,
    names: string[]
): Promise<EntityProperties> {
    let schema = await getQsSchema();
    let wanted: { name: string; pid: string; type: string }[] = [];
    let unknownProps: string[] = [];
    const resolveNames = () => {
        wanted = [];
        unknownProps = [];
        for (const name of names) {
            const hit = schema.pidByName.get(name);
            if (hit) wanted.push({ name, pid: hit.pid, type: hit.type });
            else unknownProps.push(name);
        }
    };
    resolveNames();
    // The schema is cached in-process and never expires, so a name we can't
    // resolve may belong to a flavor/property ingested after we cached it
    // (common for custom data sources whose schema grows at runtime).
    // Refresh once and re-resolve before treating it as unknown.
    if (unknownProps.length > 0) {
        schema = await getQsSchema(true);
        resolveNames();
    }

    const raw: Record<string, string | null> = {};
    const values: Record<string, string | null> = {};
    for (const w of wanted) {
        raw[w.name] = null;
        values[w.name] = null;
    }
    if (wanted.length === 0) return { values, raw, unknownProps };

    // Big/negative PIDs must NOT go through JSON.stringify of a JS number
    // (it rounds). Interpolate the string pids straight into the array.
    const pidArray = `[${wanted.map((w) => w.pid).join(',')}]`;
    const form = new URLSearchParams();
    form.set('eids', JSON.stringify([neid]));
    form.set('pids', pidArray);

    const res = (await qsFetch('elemental/entities/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
    })) as any;

    // Dedup: one row per (eid, pid) — first source wins.
    const byPid = new Map<string, string>();
    for (const v of res?.values ?? []) {
        const pid = String(v?.pid ?? '');
        if (!pid || byPid.has(pid)) continue;
        if (v?.value === null || v?.value === undefined) continue;
        byPid.set(pid, String(v.value));
    }

    // Collect nindex references to resolve their display names in one batch.
    const refNeids = new Set<string>();
    for (const w of wanted) {
        const val = byPid.get(w.pid);
        if (val === undefined) continue;
        if (w.type === 'data_nindex') {
            const padded = padNeid(val);
            raw[w.name] = padded;
            refNeids.add(padded);
        } else {
            raw[w.name] = val;
            values[w.name] = val;
        }
    }

    if (refNeids.size > 0) {
        const nameByNeid = await resolveEntityNames([...refNeids]);
        for (const w of wanted) {
            if (w.type !== 'data_nindex') continue;
            const padded = raw[w.name];
            values[w.name] = padded ? (nameByNeid[padded] ?? padded) : null;
        }
    }

    return { values, raw, unknownProps };
}

/**
 * Count entities linked to `neid` via the graph layer (`linked`
 * expression), returning the count plus a small sample of linked NEIDs.
 * Pass relationship `pids` to restrict to specific edge types (discover
 * them from the schema — don't hardcode). For property-layer references
 * (filings, documents, …) use `getPropertiesByName` with the relationship
 * property instead; this is for first-class graph nodes.
 */
export async function findLinkedCount(
    neid: string,
    opts: {
        pids?: string[];
        direction?: 'incoming' | 'outgoing';
        distance?: number;
        limit?: number;
        sampleSize?: number;
    } = {}
): Promise<LinkedResult> {
    const linked: Record<string, unknown> = {
        to_entity: neid,
        distance: opts.distance ?? 1,
        direction: opts.direction ?? 'incoming',
    };
    if (opts.pids?.length) linked.pids = opts.pids;

    const form = new URLSearchParams();
    form.set('expression', JSON.stringify({ type: 'linked', linked }));
    form.set('limit', String(opts.limit ?? 50));

    const res = (await qsFetch('elemental/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
    })) as any;

    const eids: string[] = (res?.eids ?? []).map((e: unknown) => padNeid(String(e)));
    return { count: eids.length, sampleNeids: eids.slice(0, opts.sampleSize ?? 5) };
}

/**
 * Resolve display names for a batch of NEIDs via `GET /entities/{neid}/name`.
 * Input is de-duplicated; failures resolve to no entry (caller falls back
 * to the NEID). Returns a `{ [neid]: name }` map.
 */
export async function resolveEntityNames(neids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(neids)].filter(Boolean);
    const out: Record<string, string> = {};
    await Promise.all(
        unique.map(async (neid) => {
            try {
                const res = (await qsFetch(`entities/${neid}/name`)) as { name?: string };
                if (res?.name) out[neid] = res.name;
            } catch {
                // not-found / transient — caller falls back to the NEID
            }
        })
    );
    return out;
}
