/**
 * Same-origin Query Server health probe.
 *
 * The browser CANNOT reach the Query Server directly: a tenant UI served
 * from `https://ui.<slug>.tenant.g.lovelace.ai` calling the Portal QS proxy
 * at `https://broadchurch-portal…/api/qs/<org>/status` is cross-origin, so
 * the preflight fails CORS (and there's no usable user token on the login
 * page anyway). That's exactly the `Access-Control-Allow-Origin` error you
 * see in the console.
 *
 * So the client polls THIS route instead (same-origin → no CORS), and we
 * reach the QS server-side — the identical path the data plane uses
 * (`server/utils` + the proxy's `X-Api-Key`). Purely informational: nothing
 * in the app should gate on the result.
 */
export default defineEventHandler(async () => {
    const pub = useRuntimeConfig().public as Record<string, string>;
    const gatewayUrl = pub.gatewayUrl;
    const tenantOrgId = pub.tenantOrgId;
    const qsApiKey = pub.qsApiKey;
    const serverAddress = pub.queryServerAddress;

    let baseURL = '';
    const headers: Record<string, string> = {};

    if (isQsDirect()) {
        // Direct in-cluster — probe the serving address (/status needs no auth).
        baseURL = serverAddress.replace(/\/$/, '');
    } else if (gatewayUrl && tenantOrgId && qsApiKey) {
        // Portal QS proxy.
        baseURL = `${gatewayUrl}/api/qs/${tenantOrgId}`;
        headers['X-Api-Key'] = qsApiKey;
    } else if (serverAddress) {
        baseURL = serverAddress.startsWith('http') ? serverAddress : `https://${serverAddress}`;
    } else {
        return { status: 'not-configured' as const };
    }

    try {
        await $fetch('/status', { baseURL, headers, timeout: 5000 });
        return { status: 'available' as const, address: baseURL };
    } catch (error) {
        return {
            status: 'unavailable' as const,
            address: baseURL,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
