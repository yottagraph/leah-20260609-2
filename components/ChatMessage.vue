<template>
    <div class="d-flex mb-4" :class="isUser ? 'justify-end' : 'justify-start'">
        <div
            class="chat-bubble pa-3 rounded-lg"
            :class="[isUser ? 'user-bubble' : 'agent-bubble', message.error ? 'error-bubble' : '']"
            style="max-width: 80%; word-break: break-word"
        >
            <div v-if="!isUser" class="d-flex align-center mb-1">
                <v-icon size="16" class="mr-1" :color="message.error ? 'error' : 'primary'">
                    {{ message.error ? 'mdi-alert-circle' : 'mdi-robot' }}
                </v-icon>
                <span class="text-caption text-medium-emphasis">Agent</span>
            </div>

            <div v-if="message.streaming && !message.text" class="typing-indicator">
                <span /><span /><span />
            </div>
            <!-- User text is shown verbatim; agent replies are GitHub-flavoured
                 Markdown (tables/bold/lists) rendered to sanitized HTML. -->
            <div v-else-if="isUser" class="text-body-2 bubble-text user-text">
                {{ message.text }}
            </div>
            <div v-else class="text-body-2 bubble-text md-body">
                <span v-html="rendered" />
                <span v-if="message.streaming" class="streaming-cursor" />
            </div>

            <div class="text-caption text-medium-emphasis mt-1" style="opacity: 0.6">
                {{ formatTime(message.timestamp) }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import type { ChatMessage } from '~/composables/useAgentChat';
    // Explicit import: this template disables utils/ auto-import scanning in
    // nuxt.config.ts (`imports:dirs` hook), so utils are NOT auto-imported.
    import { renderMarkdown } from '~/utils/renderMarkdown';

    const props = defineProps<{ message: ChatMessage }>();
    const isUser = computed(() => props.message.role === 'user');
    const rendered = computed(() => renderMarkdown(props.message.text));

    function formatTime(ts: number): string {
        return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
</script>

<style scoped>
    .user-bubble {
        background: rgba(63, 234, 0, 0.12);
        border: 1px solid rgba(63, 234, 0, 0.25);
    }
    .agent-bubble {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .error-bubble {
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .bubble-text {
        color: rgba(255, 255, 255, 0.87);
    }
    .user-text {
        white-space: pre-wrap;
    }

    /* ── Rendered Markdown ─────────────────────────────────────────── */
    .md-body :deep(p) {
        margin: 0 0 8px;
    }
    .md-body :deep(p:last-child) {
        margin-bottom: 0;
    }
    .md-body :deep(.md-h) {
        font-size: 0.95rem;
        font-weight: 600;
        margin: 10px 0 4px;
    }
    .md-body :deep(.md-list) {
        margin: 4px 0 8px;
        padding-left: 20px;
    }
    .md-body :deep(.md-list li) {
        margin: 2px 0;
    }
    .md-body :deep(a) {
        color: rgb(120, 220, 90);
        text-decoration: underline;
    }
    .md-body :deep(strong) {
        font-weight: 600;
        color: #fff;
    }
    .md-body :deep(.md-code) {
        font-family: 'Roboto Mono', monospace;
        font-size: 0.82em;
        background: rgba(255, 255, 255, 0.1);
        padding: 1px 5px;
        border-radius: 4px;
    }
    .md-body :deep(.md-pre) {
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        padding: 8px 10px;
        overflow-x: auto;
        margin: 6px 0;
    }
    .md-body :deep(.md-pre code) {
        font-family: 'Roboto Mono', monospace;
        font-size: 0.82em;
        background: none;
        padding: 0;
    }
    .md-body :deep(.md-quote) {
        border-left: 3px solid rgba(63, 234, 0, 0.4);
        padding-left: 10px;
        margin: 6px 0;
        color: rgba(255, 255, 255, 0.7);
    }
    .md-body :deep(hr) {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
        margin: 10px 0;
    }

    /* GFM tables — agents' primary structured-answer format. */
    .md-body :deep(.md-table-wrap) {
        overflow-x: auto;
        margin: 6px 0;
    }
    .md-body :deep(.md-table) {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.8rem;
    }
    .md-body :deep(.md-table th),
    .md-body :deep(.md-table td) {
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 4px 8px;
        text-align: left;
        white-space: nowrap;
    }
    .md-body :deep(.md-table th) {
        background: rgba(255, 255, 255, 0.06);
        font-weight: 600;
    }
    .md-body :deep(.md-table tbody tr:nth-child(even)) {
        background: rgba(255, 255, 255, 0.03);
    }

    .streaming-cursor {
        display: inline-block;
        width: 2px;
        height: 1em;
        background: currentColor;
        margin-left: 1px;
        vertical-align: text-bottom;
        animation: cursor-blink 0.8s steps(2) infinite;
    }

    @keyframes cursor-blink {
        0% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }

    .typing-indicator {
        display: flex;
        gap: 4px;
        padding: 4px 0;
    }

    .typing-indicator span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.4);
        animation: typing-bounce 1.2s ease-in-out infinite;
    }

    .typing-indicator span:nth-child(2) {
        animation-delay: 0.15s;
    }

    .typing-indicator span:nth-child(3) {
        animation-delay: 0.3s;
    }

    @keyframes typing-bounce {
        0%,
        60%,
        100% {
            transform: translateY(0);
            opacity: 0.4;
        }
        30% {
            transform: translateY(-4px);
            opacity: 1;
        }
    }
</style>
