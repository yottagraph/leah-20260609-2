<template>
    <div class="tenancy-probe">
        <PageHeader
            title="Tenancy probe"
            subtitle="Which BC 2.0 per-tenant data planes are reachable from where this server runs"
        />

        <v-card class="mb-4">
            <v-card-text class="d-flex align-center flex-wrap ga-2">
                <v-btn :loading="pending" color="primary" @click="refresh">Re-run probe</v-btn>
                <v-chip variant="tonal">agentHosting: {{ data?.env?.agentHosting ?? '?' }}</v-chip>
                <v-chip variant="tonal">
                    gcp: {{ data?.env?.gcpDirect ? 'direct (WI)' : 'gateway' }}
                </v-chip>
                <v-chip variant="tonal">node: {{ data?.env?.nodeEnv ?? '?' }}</v-chip>
                <v-spacer />
                <span v-if="data" class="text-medium-emphasis text-caption">
                    checked {{ data.checkedAt }}
                </span>
            </v-card-text>
        </v-card>

        <v-card>
            <v-table>
                <thead>
                    <tr>
                        <th>Plane</th>
                        <th>Status</th>
                        <th>Transport</th>
                        <th class="text-right">ms</th>
                        <th>Detail</th>
                        <th>Error</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="p in data?.planes ?? []" :key="p.plane">
                        <td class="font-weight-medium">{{ p.plane }}</td>
                        <td>
                            <v-chip :color="statusColor(p.status)" size="small" variant="flat">
                                {{ statusLabel(p.status) }}
                            </v-chip>
                        </td>
                        <td>{{ p.transport }}</td>
                        <td class="text-right">{{ p.ms }}</td>
                        <td class="text-caption">{{ p.detail }}</td>
                        <td class="text-caption text-error" style="max-width: 360px">
                            {{ p.error }}
                        </td>
                    </tr>
                    <tr v-if="!data && pending">
                        <td colspan="6" class="text-center text-medium-emphasis py-6">
                            Probing planes…
                        </td>
                    </tr>
                </tbody>
            </v-table>
        </v-card>

        <p class="hint mt-4 text-medium-emphasis text-caption">
            <strong>ok</strong> = configured + live round-trip · <strong>fallback</strong> = working
            via local-dev fallback (e.g. localfs prefs) · <strong>unconfigured</strong> = transport
            not wired in this process · <strong>error</strong> = configured but the round-trip
            failed (warming up / unreachable).
        </p>
    </div>
</template>

<script setup lang="ts">
    interface PlaneResult {
        plane: string;
        status: 'ok' | 'fallback' | 'unconfigured' | 'error';
        transport: string;
        ms: number;
        detail: string;
        error: string | null;
    }
    interface ProbeResponse {
        checkedAt: string;
        env: { agentHosting: string; gcpDirect: boolean; nodeEnv: string };
        summary: Record<string, number>;
        planes: PlaneResult[];
    }

    const { data, pending, refresh } = await useFetch<ProbeResponse>('/api/tenancy-probe', {
        lazy: true,
        server: false,
    });

    function statusColor(s: PlaneResult['status']): string {
        return { ok: 'success', fallback: 'warning', unconfigured: 'grey', error: 'error' }[s];
    }
    function statusLabel(s: PlaneResult['status']): string {
        return {
            ok: '✅ ok',
            fallback: '⚠️ fallback',
            unconfigured: '○ unconfigured',
            error: '❌ error',
        }[s];
    }
</script>

<style scoped>
    .tenancy-probe {
        max-width: 1100px;
        margin: 0 auto;
        padding: 1rem;
    }
</style>
