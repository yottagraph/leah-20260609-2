import { isDbConfigured, dbMode, getSqlRaw } from '~/server/utils/db';

/**
 * `/api/_version` — platform/meta health + rollout probe.
 *
 * Built for cloud build agents (and humans) who just pushed a change and
 * need to answer, from OUTSIDE the cluster, two questions the GHA workflow
 * status can't:
 *
 *   1. Is the NEW image actually serving yet? ArgoCD reconciliation lags the
 *      deploy workflow's "success" by minutes. `started_at` flips to a recent
 *      time when the rolled pod comes up (it's captured once at process
 *      start, so it's the pod's boot time); `git_sha` / `image` / `built_at`
 *      pin the exact build when the deploy pipeline injects them (else null).
 *   2. Is Cloud SQL warm yet? Cloud SQL warms ~5-15 min after provision.
 *      `db.reachable` is a bounded `SELECT 1` — true once the instance +
 *      proxy sidecar are up.
 *
 * Poll it after `git push`: when `started_at` is newer than your push and
 * `db.reachable` is true, the tenant is ready. Never throws — always 200 with
 * a stable shape so a poller can rely on it.
 */

// Captured once when the server bundle is first loaded — i.e. when this
// pod/process started. After a rollout the freshly-scheduled pod reports a
// new value, which is the simplest "is the new image serving?" signal that
// needs no build-time injection.
const PROCESS_STARTED_AT = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();

async function probeDb(): Promise<boolean | null> {
    if (!isDbConfigured()) return null;
    const run = getSqlRaw();
    if (!run) return null;
    try {
        // Bound the probe so a not-yet-warm instance can't hang the route.
        await Promise.race([
            run('SELECT 1'),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('db probe timeout')), 3000)
            ),
        ]);
        return true;
    } catch {
        // Configured but not reachable yet (warming up) — not an error here.
        return false;
    }
}

export default defineEventHandler(async () => {
    const cfg = useRuntimeConfig().public as Record<string, unknown>;
    const dbReachable = await probeDb();

    return {
        app: { id: cfg.appId ?? null, name: cfg.appName ?? null },
        agent_hosting: cfg.agentHosting ?? null,
        // Populated by the deploy pipeline when available; null otherwise.
        // `started_at` below is always present and is enough on its own to
        // tell that a new pod has rolled.
        git_sha: process.env.GIT_SHA || process.env.NUXT_PUBLIC_GIT_SHA || null,
        image: process.env.APP_IMAGE || null,
        built_at: process.env.APP_BUILT_AT || null,
        started_at: PROCESS_STARTED_AT,
        uptime_s: Math.round(process.uptime()),
        node_env: process.env.NODE_ENV ?? null,
        db: {
            configured: isDbConfigured(),
            mode: dbMode(),
            reachable: dbReachable,
        },
        now: new Date().toISOString(),
    };
});
