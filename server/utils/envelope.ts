/**
 * Canonical envelope for a server route that can legitimately return partial,
 * empty, or degraded data (the data plane is warming, a capability isn't
 * loaded, an upstream errored, …). It lets the client tell "ready" apart from
 * "reachable but not fully there yet" WITHOUT every app inventing its own
 * ad-hoc `{ error?, warming?, reason? }` flags.
 *
 * The principle from the platform brief — "if a layer is unreachable, say so;
 * never synthesize a healthy-looking empty state" — only works if there's a
 * shared shape for saying so. This is that shape. Pair it on the client with
 * `usePlatformStatus()` / `<PlatformStatusBanner>` for QS health, or render the
 * `state`/`reason` directly.
 *
 *   import { ready, degraded } from '~/server/utils/envelope';
 *
 *   if (!isQsConfigured()) return degraded(emptyResult, 'unconfigured', 'Query Server not wired yet');
 *   const r = await qsRequest('prism/scan-news', { ... });
 *   if (!r.ok) return degraded(emptyResult, 'upstream_error', `prism/scan-news → ${r.status ?? 'no response'}`, { status: r.status });
 *   return ready(parse(r.body));
 */

export type AetherEnvelopeState =
    | 'ready'
    | 'warming'
    | 'unconfigured'
    | 'capability_missing'
    | 'upstream_error';

export interface AetherEnvelope<T> {
    /** The request itself succeeded — inspect `state` for data *health*. */
    ok: true;
    /** Possibly partial / empty when `state !== 'ready'`. */
    data: T;
    state: AetherEnvelopeState;
    /** Human-readable why, present when `state !== 'ready'`. */
    reason?: string;
    /** Optional structured context (status codes, failing endpoints, …). */
    detail?: Record<string, unknown>;
}

/** A fully-ready envelope. */
export function ready<T>(data: T): AetherEnvelope<T> {
    return { ok: true, data, state: 'ready' };
}

/** A degraded envelope — carries (possibly empty) data plus why it's not ready. */
export function degraded<T>(
    data: T,
    state: Exclude<AetherEnvelopeState, 'ready'>,
    reason: string,
    detail?: Record<string, unknown>
): AetherEnvelope<T> {
    return { ok: true, data, state, reason, ...(detail ? { detail } : {}) };
}
