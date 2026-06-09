/**
 * Client-side view of Query Server health, backed by `GET /api/platform/status`.
 * Drop `<PlatformStatusBanner>` on a page (or call this directly) so a degraded
 * data plane surfaces honestly instead of masquerading as empty data.
 *
 *   const { hasIssues, issueHeadline, refresh } = usePlatformStatus({ include: ['prism', 'galaxy'] });
 *
 * State is shared (useState) so multiple consumers stay in sync and only one
 * probe runs per refresh.
 */
export interface PlatformProbe {
    endpoint: string;
    method: string;
    ok: boolean;
    status: number | null;
    bytes: number;
    error: string | null;
    ms: number;
}

export interface PlatformStatus {
    ok: boolean;
    qsConfigured: boolean;
    checkedAt: string;
    qs: {
        ok: boolean;
        status: number | null;
        instanceUuid: string | null;
        startTime: string | null;
        capabilities: string[];
    } | null;
    probes: PlatformProbe[];
    summary: Record<string, boolean>;
}

export function usePlatformStatus(opts: { include?: string[] } = {}) {
    const status = useState<PlatformStatus | null>('aether-platform-status', () => null);
    const loading = useState<boolean>('aether-platform-status-loading', () => false);
    const query = opts.include?.length ? `?include=${opts.include.join(',')}` : '';

    async function refresh(force = false): Promise<void> {
        if (loading.value) return;
        if (status.value && !force) return;
        loading.value = true;
        try {
            status.value = await $fetch<PlatformStatus>(`/api/platform/status${query}`);
        } catch {
            // Leave the last-known status in place; the probe route itself
            // rarely fails (it catches per-endpoint), so this is a transport blip.
        } finally {
            loading.value = false;
        }
    }

    // An "issue" is a real probe failure on a configured QS — not "unconfigured"
    // (that's an expected pre-provision state, not an alarm) and not the
    // capability list (informational; we don't gate on it).
    const hasIssues = computed(() => {
        const s = status.value;
        if (!s || !s.qsConfigured) return false;
        return !s.ok || s.probes.some((p) => !p.ok);
    });

    const issueHeadline = computed(() => {
        const s = status.value;
        if (!s || !hasIssues.value) return '';
        const failing = s.probes.filter((p) => !p.ok);
        if (failing.length === 0) return 'The Query Server reported an issue.';
        const n = failing.length;
        return (
            `${n} Query Server endpoint${n === 1 ? '' : 's'} failing: ` +
            failing.map((p) => `${p.endpoint} → ${p.status ?? 'no response'}`).join(', ')
        );
    });

    return { status, loading, hasIssues, issueHeadline, refresh };
}
