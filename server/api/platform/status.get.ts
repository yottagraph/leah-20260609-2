/**
 * Generic Query Server health probe. Every Aether app that talks to the QS
 * needs an honest "is the data plane actually serving?" check — otherwise a
 * silent 502 masquerades as "no data" (see FEEDBACK from the Prism build).
 *
 * It probes the CORE elemental surfaces always (status, schema, entity
 * search) and the prism / galaxy surfaces only when asked, since not every
 * app uses them:
 *
 *   GET /api/platform/status                 → core elemental probes
 *   GET /api/platform/status?include=prism,galaxy
 *
 * Health is judged by the actual HTTP status of each probe, NOT by the QS
 * `/status.capabilities` list — that list under-reports (it omits `galaxy`/
 * `prism` even when those endpoints serve fine), so it's surfaced as
 * informational only. Back the cockpit-style banner with `usePlatformStatus()`.
 */
import { isQsConfigured, qsRequest } from '~/server/utils/elementalQs';

interface PlatformProbe {
    endpoint: string;
    method: string;
    ok: boolean;
    status: number | null;
    bytes: number;
    error: string | null;
    ms: number;
}

// A well-known NEID (Apple) so entity/graph probes exercise the real happy
// path rather than an empty miss.
const APPLE_NEID = '00203728916542332765';

async function probe(
    endpoint: string,
    method: 'GET' | 'POST',
    body?: unknown
): Promise<PlatformProbe> {
    const r = await qsRequest(endpoint, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        timeout: 8000,
    });
    return {
        endpoint: r.endpoint,
        method,
        ok: r.ok,
        status: r.status,
        bytes: r.body == null ? 0 : JSON.stringify(r.body).length,
        error: r.error,
        ms: r.durationMs,
    };
}

export default defineEventHandler(async (event) => {
    const checkedAt = new Date().toISOString();

    if (!isQsConfigured()) {
        return {
            ok: false,
            qsConfigured: false,
            checkedAt,
            qs: null,
            probes: [] as PlatformProbe[],
            summary: {} as Record<string, boolean>,
        };
    }

    const include = String(getQuery(event).include ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const wantPrism = include.includes('prism');
    const wantGalaxy = include.includes('galaxy');

    const statusReq = await qsRequest<any>('status', { timeout: 8000 });
    const capabilities: string[] = Array.isArray(statusReq.body?.capabilities)
        ? statusReq.body.capabilities
        : [];

    const tasks: Promise<PlatformProbe>[] = [
        probe('elemental/metadata/schema', 'GET'),
        probe('entities/search', 'POST', {
            queries: [{ queryId: 1, query: 'Apple' }],
            maxResults: 1,
            includeNames: true,
        }),
    ];
    if (wantGalaxy) tasks.push(probe(`galaxy/${APPLE_NEID}/info`, 'GET'));
    if (wantPrism) tasks.push(probe('prism/schema', 'GET'));
    const probes = await Promise.all(tasks);

    const groupHealthy = (pred: (p: PlatformProbe) => boolean) => {
        const group = probes.filter(pred);
        return group.length > 0 && group.every((p) => p.ok);
    };

    return {
        ok: statusReq.ok && probes.every((p) => p.ok),
        qsConfigured: true,
        checkedAt,
        qs: {
            ok: statusReq.ok,
            status: statusReq.status,
            instanceUuid: statusReq.body?.qs_instance_uuid ?? null,
            startTime: statusReq.body?.qs_start_time ?? null,
            // Informational only — we judge health by probe HTTP status, not this.
            capabilities,
        },
        probes,
        summary: {
            elementalHealthy: groupHealthy(
                (p) => p.endpoint.startsWith('elemental') || p.endpoint.startsWith('entities')
            ),
            ...(wantGalaxy
                ? { galaxyHealthy: groupHealthy((p) => p.endpoint.startsWith('galaxy/')) }
                : {}),
            ...(wantPrism
                ? { prismHealthy: groupHealthy((p) => p.endpoint.startsWith('prism/')) }
                : {}),
        },
    };
});
