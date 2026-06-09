/**
 * Tenancy probe — exercises every BC 2.0 per-tenant data plane through the
 * app's OWN dual-transport server utilities and reports, per plane, whether
 * it's reachable from wherever this Nitro process is running.
 *
 * The whole point is the local-dev A/B: run it under `npm run dev` (Phase A,
 * no .env.bridge) and again with the bridge (Phase B, `npm run bridge` then
 * restart) and watch which planes flip from `unconfigured`/`fallback` to
 * `ok`. See `.agents/skills/aether/local-dev-bc2.md`. It is intentionally
 * read-only and never throws to the client — each plane is independently
 * try/caught so one dead plane can't blank the page.
 *
 * Status vocabulary (per plane):
 *   ok           — configured AND a live round-trip succeeded
 *   fallback     — working, but via the local-dev fallback (e.g. localfs prefs)
 *   unconfigured — the transport env isn't wired up in this process
 *   error        — configured but the round-trip failed (warming up / unreachable)
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isQsConfigured, qsRequest } from '~/server/utils/elementalQs';
import {
    isFirestoreConfigured,
    shouldUseLocalFsFallback,
    getFirestoreDb,
} from '~/server/utils/firestore';
import {
    isBigQueryConfigured,
    runQuery,
    getDefaultDataset,
    getBigQueryProjectId,
} from '~/server/utils/bigquery';
import { isDbConfigured, dbMode, getDb } from '~/server/utils/db';
import { callAgent } from '~/server/utils/agentCall';

type ProbeStatus = 'ok' | 'fallback' | 'unconfigured' | 'error';

interface PlaneResult {
    plane: string;
    status: ProbeStatus;
    transport: string;
    ms: number;
    detail: string;
    error: string | null;
}

/**
 * Derive the ADK agent id (app name) to ping. The agent id is the directory
 * name under `agents/` that holds an `agent.py`, so we don't hardcode it —
 * any tenant's first agent is probed automatically. Returns null when there
 * is no `agents/` dir (e.g. a UI-only build), so the Agent plane reports
 * `unconfigured` instead of throwing.
 */
function deriveAgentId(): string | null {
    const agentsDir = join(process.cwd(), 'agents');
    if (!existsSync(agentsDir)) return null;
    try {
        const entries = readdirSync(agentsDir, { withFileTypes: true });
        const candidates = entries
            .filter(
                (e) =>
                    e.isDirectory() &&
                    !e.name.startsWith('.') &&
                    e.name !== 'tests' &&
                    e.name !== '__pycache__'
            )
            .map((e) => e.name)
            .sort();
        for (const name of candidates) {
            if (existsSync(join(agentsDir, name, 'agent.py'))) return name;
        }
    } catch {
        return null;
    }
    return null;
}

async function timed(
    plane: string,
    fn: () => Promise<Omit<PlaneResult, 'plane' | 'ms'>>
): Promise<PlaneResult> {
    const t0 = Date.now();
    try {
        const r = await fn();
        return { plane, ms: Date.now() - t0, ...r };
    } catch (e: unknown) {
        const err = e as { message?: string; statusMessage?: string };
        return {
            plane,
            status: 'error',
            transport: '—',
            ms: Date.now() - t0,
            detail: 'threw',
            error: (err?.statusMessage || err?.message || String(e)).slice(0, 300),
        };
    }
}

export default defineEventHandler(async () => {
    const runtime = useRuntimeConfig();
    const pub = (runtime.public ?? {}) as Record<string, unknown>;
    const agentHostingCfg = String(pub.agentHosting || 'agent_engine');

    // Gateway vs direct is decided by GOOGLE_CLOUD_PROJECT (only set inside a
    // GKE pod, or locally by the bridge). Locally without the bridge this is
    // always the gateway transport.
    const gcpDirect = !!process.env.GOOGLE_CLOUD_PROJECT && process.env.VERCEL !== '1';

    const agentId = deriveAgentId();

    const results = await Promise.all([
        // ── Elemental Query Server (portal proxy from broadchurch.yaml) ──
        timed('Elemental QS', async () => {
            if (!isQsConfigured()) {
                return {
                    status: 'unconfigured',
                    transport: '—',
                    detail: 'no gateway/org/key',
                    error: null,
                };
            }
            const r = await qsRequest('status', { timeout: 8000 });
            return {
                status: r.ok ? 'ok' : 'error',
                transport: 'portal proxy',
                detail: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status ?? 'none'}`,
                error: r.error,
            };
        }),

        // ── Prefs / Firestore (real Firestore via ADC, or localfs fallback) ──
        timed('Prefs / Firestore', async () => {
            if (isFirestoreConfigured()) {
                const db = getFirestoreDb();
                if (!db) {
                    return {
                        status: 'error',
                        transport: 'firestore',
                        detail: 'enabled but no handle',
                        error: 'getFirestoreDb() null',
                    };
                }
                const ref = db.doc('_aether_probe/heartbeat');
                const at = new Date().toISOString();
                await ref.set({ at }, { merge: true });
                const snap = await ref.get();
                const got = (snap.data() as { at?: string } | undefined)?.at ?? null;
                return {
                    status: 'ok',
                    transport: process.env.NUXT_FIRESTORE_SA_KEY
                        ? 'firestore (SA key)'
                        : 'firestore (ADC)',
                    detail: `round-trip ok @ ${got}`,
                    error: null,
                };
            }
            if (shouldUseLocalFsFallback()) {
                return {
                    status: 'fallback',
                    transport: 'localfs',
                    detail: '.aether-dev-prefs/ (on this machine)',
                    error: null,
                };
            }
            return {
                status: 'unconfigured',
                transport: '—',
                detail: 'firestore disabled, no fallback',
                error: null,
            };
        }),

        // ── BigQuery (gateway transport locally; direct in-pod) ──
        timed('BigQuery', async () => {
            if (!isBigQueryConfigured()) {
                return {
                    status: 'unconfigured',
                    transport: '—',
                    detail: 'NUXT_PUBLIC_BIGQUERY_ENABLED unset',
                    error: null,
                };
            }
            const res = await runQuery('SELECT 1 AS n');
            const n = res.rows?.[0]?.f?.[0]?.v ?? '?';
            const project = getBigQueryProjectId() ?? '?';
            const dataset = getDefaultDataset() ?? '(none)';
            return {
                status: 'ok',
                transport: gcpDirect ? 'direct (WI)' : 'portal gateway',
                detail: `SELECT 1 → ${n} · ${project}/${dataset} · ${res.totalBytesProcessed}B`,
                error: null,
            };
        }),

        // ── Cloud SQL Postgres (proxy sidecar in-pod; DATABASE_URL locally) ──
        timed('Cloud SQL', async () => {
            if (!isDbConfigured()) {
                return {
                    status: 'unconfigured',
                    transport: '—',
                    detail: 'no DATABASE_URL / proxy env',
                    error: null,
                };
            }
            const sql = getDb();
            if (!sql) {
                return {
                    status: 'unconfigured',
                    transport: dbMode(),
                    detail: 'no transport',
                    error: null,
                };
            }
            const rows = await sql<{ n: number }>`SELECT 1 AS n`;
            return {
                status: 'ok',
                transport: dbMode(),
                detail: `SELECT 1 → ${rows?.[0]?.n ?? '?'}`,
                error: null,
            };
        }),

        // ── Agent (in-cluster GKE vs Agent Engine via gateway) ──
        timed('Agent', async () => {
            if (!agentId) {
                return {
                    status: 'unconfigured',
                    transport: '—',
                    detail: 'no agent in agents/',
                    error: null,
                };
            }
            const res = await callAgent({
                agentId,
                message: 'ping (tenancy probe)',
                timeoutMs: 25_000,
            });
            const reply = (res.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
            return {
                status: 'ok',
                transport: res.hosting,
                detail: `${agentId}: replied (${reply || 'empty'})`,
                error: null,
            };
        }),
    ]);

    const summary = results.reduce<Record<ProbeStatus, number>>(
        (acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
        },
        { ok: 0, fallback: 0, unconfigured: 0, error: 0 }
    );

    return {
        checkedAt: new Date().toISOString(),
        env: {
            agentHosting: agentHostingCfg,
            gcpDirect,
            nodeEnv: process.env.NODE_ENV ?? 'development',
        },
        summary,
        planes: results,
    };
});
