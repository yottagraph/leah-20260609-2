<template>
    <v-alert
        v-if="status && hasIssues"
        type="error"
        variant="tonal"
        density="comfortable"
        class="platform-banner"
        :icon="false"
    >
        <div class="d-flex align-start" style="gap: 12px">
            <v-icon color="error" class="mt-1">mdi-alert-octagon</v-icon>
            <div class="flex-grow-1 min-w-0">
                <div class="text-subtitle-2 mb-1">Data plane issue — results may be incomplete</div>
                <div class="text-body-2">{{ issueHeadline }}</div>
                <v-expansion-panels v-if="expanded" variant="accordion" class="mt-2">
                    <v-expansion-panel title="Endpoint probe details">
                        <template #text>
                            <div class="probe-grid">
                                <div class="probe-head">Endpoint</div>
                                <div class="probe-head">Status</div>
                                <div class="probe-head">Latency</div>
                                <div class="probe-head">Notes</div>
                                <template v-for="p in status.probes" :key="p.endpoint">
                                    <div class="probe-cell endpoint">
                                        <code>{{ p.method }} {{ p.endpoint }}</code>
                                    </div>
                                    <div class="probe-cell">
                                        <v-chip
                                            size="x-small"
                                            :color="p.ok ? 'success' : 'error'"
                                            variant="tonal"
                                        >
                                            {{ p.status ?? 'no response' }}
                                        </v-chip>
                                    </div>
                                    <div class="probe-cell mono">{{ p.ms }} ms</div>
                                    <div class="probe-cell mono trunc">
                                        {{ p.error || (p.ok ? `${p.bytes} B body` : '—') }}
                                    </div>
                                </template>
                            </div>
                            <div v-if="status.qs" class="caps-block mt-3">
                                <div class="text-caption mb-1">
                                    QS advertised capabilities:
                                    <code>[{{ (status.qs.capabilities || []).join(', ') }}]</code>
                                </div>
                                <div class="text-caption text-medium-emphasis mb-1">
                                    Informational only — health is judged by the HTTP probe results
                                    above, not the capability list (it under-reports
                                    <code>galaxy</code>/<code>prism</code>).
                                </div>
                                <div
                                    v-if="status.qs.instanceUuid"
                                    class="text-caption text-medium-emphasis mt-2"
                                >
                                    QS instance: <code>{{ status.qs.instanceUuid }}</code>
                                    <span v-if="status.qs.startTime">
                                        · started {{ status.qs.startTime }}</span
                                    >
                                </div>
                            </div>
                        </template>
                    </v-expansion-panel>
                </v-expansion-panels>
            </div>
            <v-btn
                variant="text"
                size="small"
                class="text-none"
                :prepend-icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                @click="expanded = !expanded"
                >{{ expanded ? 'Hide' : 'Details' }}</v-btn
            >
            <v-btn
                variant="text"
                size="small"
                :loading="loading"
                prepend-icon="mdi-refresh"
                class="text-none"
                @click="refresh(true)"
                >Re-check</v-btn
            >
        </div>
    </v-alert>
</template>

<script setup lang="ts">
    // Honest data-plane banner. Renders nothing while the QS is healthy or
    // unconfigured; shows failing endpoints (with HTTP status) when probes fail.
    //
    //   <PlatformStatusBanner :include="['prism', 'galaxy']" />
    import { onMounted, ref } from 'vue';

    const props = defineProps<{ include?: string[] }>();

    const { status, loading, hasIssues, issueHeadline, refresh } = usePlatformStatus({
        include: props.include,
    });
    const expanded = ref(false);

    onMounted(() => {
        void refresh();
    });
</script>

<style scoped>
    .platform-banner {
        border: 1px solid rgba(239, 68, 68, 0.4) !important;
    }

    .probe-grid {
        display: grid;
        grid-template-columns: minmax(220px, 2fr) 80px 80px minmax(0, 3fr);
        gap: 4px 12px;
        font-size: 0.8rem;
    }

    .probe-head {
        font-family: var(--font-mono, monospace);
        font-size: 0.7rem;
        text-transform: uppercase;
        opacity: 0.6;
        letter-spacing: 0.05em;
    }

    .probe-cell {
        padding: 2px 0;
    }
    .probe-cell.endpoint code {
        font-size: 0.78rem;
    }
    .probe-cell.mono {
        font-family: var(--font-mono, monospace);
        font-size: 0.78rem;
    }
    .probe-cell.trunc {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .caps-block code {
        font-size: 0.78rem;
        background: rgba(255, 255, 255, 0.05);
        padding: 1px 4px;
        border-radius: 3px;
    }
</style>
