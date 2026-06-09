// Reads the shared M2M access token from the projected file at
// `runtimeConfig.m2mTokenFile` (env NUXT_M2M_TOKEN_FILE), re-reading on mtime
// change so token rotation needs no restart. Returns null when unset/unreadable.
import { readFile, stat } from 'node:fs/promises';

const LOG_PREFIX = '[m2m-token]';

let cache: { token: string; mtimeMs: number } | null = null;

export async function getM2mToken(): Promise<string | null> {
    const tokenFile = String(useRuntimeConfig().m2mTokenFile ?? '').trim();
    if (!tokenFile) return null;

    // Fast path: reuse the cached token while the file is unchanged.
    if (cache) {
        try {
            const { mtimeMs } = await stat(tokenFile);
            if (Math.trunc(mtimeMs) === cache.mtimeMs) return cache.token;
        } catch {
            /* missing / transient — fall through to a fresh read */
        }
    }

    try {
        const { mtimeMs } = await stat(tokenFile);
        const token = (await readFile(tokenFile, 'utf8')).trim();
        if (!token) {
            console.warn(`${LOG_PREFIX} M2M token file is empty:`, tokenFile);
            cache = null;
            return null;
        }
        cache = { token, mtimeMs: Math.trunc(mtimeMs) };
        return token;
    } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException)?.code;
        console.warn(`${LOG_PREFIX} failed to read M2M token file (${tokenFile}):`, code || e);
        cache = null;
        return null;
    }
}
