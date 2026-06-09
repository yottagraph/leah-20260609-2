#!/usr/bin/env node
/**
 * make-bridge — generate a `.env.bridge` for LOCAL BC 2.0 tenant dev.
 *
 * The model: in local dev YOU are the workload identity. Instead of the GKE
 * pod's metadata-server token, every plane is reached from your laptop via
 * your `gcloud` Application Default Credentials (+ SA impersonation for Cloud
 * SQL). See `.agents/skills/aether/local-dev-bc2.md`.
 *
 * Three of the coordinates a BC 2.0 app needs carry random Terraform suffixes
 * and so AREN'T in `broadchurch.yaml`: the per-tenant GCP project id, the
 * Cloud SQL connection name, and the runtime GSA to impersonate. The
 * Broadchurch Portal provisioned them, so it's the single source of truth —
 * this script reads `broadchurch.yaml` for the org_id + gateway + (non-secret)
 * qs_api_key, calls `GET {gateway}/api/v2/projects/{org}/local-dev-bridge`,
 * and writes a ready-to-apply `.env.bridge`.
 *
 * Usage (from the tenant repo root):
 *   gcloud auth login
 *   gcloud auth application-default login
 *   npm run bridge                 # writes .env.bridge
 *   cat .env.bridge >> .env && npm run dev
 *   open http://localhost:3000/tenancy-probe
 *
 * No secrets are written beyond the already-public qs_api_key (which already
 * ships in broadchurch.yaml). Local dev authenticates as the human via ADC.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const BC_PATH = path.join(ROOT, 'broadchurch.yaml');
const OUT_PATH = path.join(ROOT, '.env.bridge');

// --- minimal broadchurch.yaml readers (mirrors init-project.js) -------------
function yamlSection(yaml, sectionName) {
    const sectionRe = new RegExp(`^${sectionName}:\\s*$`, 'm');
    const sectionStart = yaml.search(sectionRe);
    if (sectionStart === -1) return '';
    const afterHeader = yaml.indexOf('\n', sectionStart);
    if (afterHeader === -1) return '';
    const rest = yaml.slice(afterHeader + 1);
    const nextSection = rest.search(/^\S.*:/m);
    return nextSection === -1 ? rest : rest.slice(0, nextSection);
}
function yamlSectionValue(yaml, sectionName, key) {
    const block = yamlSection(yaml, sectionName);
    const match = block.match(new RegExp(`${key}:\\s*["']?([^\\s"'#]+)`));
    return match ? match[1] : '';
}

function fail(msg) {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

/**
 * Resolve the Cloud SQL connection name with YOUR local gcloud, as a fallback
 * for when the portal couldn't (the per-tenant Postgres instance name carries
 * a random Terraform suffix, and the portal control-plane SA isn't currently
 * entitled to list instances in tenant projects — see docs/BC_2_LOCAL_DEV.md).
 *
 * This stays true to the "locally YOU are the workload identity" model: you're
 * about to impersonate the runtime GSA through the Auth Proxy anyway, so
 * resolving the instance name with your own ADC is the same trust boundary.
 * Needs `cloudsql.instances.list` (roles/cloudsql.viewer — grant-local-dev-access
 * adds it). Returns null on any failure so generation still succeeds.
 */
function resolveConnNameLocally(project, slug) {
    try {
        const out = execFileSync(
            'gcloud',
            [
                'sql',
                'instances',
                'list',
                `--project=${project}`,
                '--format=json',
            ],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        const instances = JSON.parse(out || '[]');
        if (!Array.isArray(instances) || instances.length === 0) return null;
        const runnable = instances.filter((i) => i.state === 'RUNNABLE');
        const pool = runnable.length > 0 ? runnable : instances;
        const pick =
            pool.find((i) => String(i.name || '').includes(`${slug}-pg`)) ||
            pool.find((i) => String(i.name || '').includes(slug)) ||
            pool[0];
        return pick?.connectionName || null;
    } catch {
        return null;
    }
}

if (!fs.existsSync(BC_PATH)) {
    fail(
        'No broadchurch.yaml found in this directory. Run this from the tenant repo root.\n' +
            '   (broadchurch.yaml is written at provision time and carries the org_id + gateway.)'
    );
}

const yaml = fs.readFileSync(BC_PATH, 'utf-8');
const orgId = yamlSectionValue(yaml, 'tenant', 'org_id');
const gatewayUrl = (yamlSectionValue(yaml, 'gateway', 'url') || '').replace(/\/+$/, '');
const qsApiKey = yamlSectionValue(yaml, 'gateway', 'qs_api_key');

if (!orgId) fail('Could not read tenant.org_id from broadchurch.yaml.');
if (!gatewayUrl) fail('Could not read gateway.url from broadchurch.yaml.');

const endpoint = `${gatewayUrl}/api/v2/projects/${encodeURIComponent(orgId)}/local-dev-bridge`;

console.log(`→ Resolving local-dev bridge for ${orgId}`);
console.log(`  ${endpoint}`);

let bridge;
try {
    const resp = await fetch(endpoint, {
        headers: qsApiKey ? { 'X-Api-Key': qsApiKey } : {},
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        fail(
            `Portal returned HTTP ${resp.status} for the bridge endpoint.\n   ${body.slice(0, 300)}\n` +
                (resp.status === 401 || resp.status === 403
                    ? '   Auth failed — check gateway.qs_api_key in broadchurch.yaml, or sign in to the portal.'
                    : resp.status === 404
                      ? '   The portal may not have deployed this endpoint yet, or the org_id is wrong.'
                      : '')
        );
    }
    bridge = await resp.json();
} catch (e) {
    fail(`Failed to reach the portal bridge endpoint: ${e?.message || e}`);
}

const {
    slug = orgId,
    gcp_project: gcpProject,
    region = 'us-central1',
    runtime_gsa: runtimeGsa,
    query_server_url: queryServerUrl,
    bigquery = {},
    firestore = {},
    cloud_sql: cloudSql = {},
    agent = {},
    warnings = [],
} = bridge;

if (Array.isArray(warnings) && warnings.length) {
    console.log('\n⚠️  Portal reported caveats (some planes may not be ready):');
    for (const w of warnings) console.log(`   - ${w}`);
}

if (!gcpProject) {
    fail(
        'The portal could not resolve this tenant\'s GCP project yet — it may still be\n' +
            '   provisioning. Re-run `npm run bridge` in a few minutes.'
    );
}

// --- compose .env.bridge ----------------------------------------------------
const L = [];
const cloudSqlPort = '5432';

L.push('# ─────────────────────────────────────────────────────────────────────────');
L.push(`# Local-dev "tenancy bridge" for a BC 2.0 tenant (${slug})`);
L.push(`#   ${orgId} · GCP project ${gcpProject} · ${region}`);
L.push('#');
L.push('# Generated by `npm run bridge` from the portal — DO NOT hand-edit; re-run');
L.push('# the generator instead. Contains NO secrets (the only key here, the QS');
L.push('# proxy key, is already in broadchurch.yaml and ships to the browser).');
L.push('#');
L.push('# Model: in local dev YOU are the workload identity. Each plane is reached');
L.push('# DIRECTLY against the tenant\'s own GCP project using your `gcloud`');
L.push('# Application Default Credentials — the same code path the in-cluster pod');
L.push('# uses, just with the token from your laptop instead of the GKE metadata');
L.push('# server.');
L.push('#');
L.push('# One-time prerequisites:');
L.push('#   1. gcloud auth application-default login');
L.push(`#   2. scripts/grant-local-dev-access.sh ${gcpProject}`);
L.push('#');
L.push('# Apply + run:');
L.push('#   cat .env.bridge >> .env && npm run dev');
L.push('#   open http://localhost:3000/tenancy-probe  → "Re-run probe"');
L.push('# ─────────────────────────────────────────────────────────────────────────');
L.push('');
L.push('# --- DIRECT transport switch -------------------------------------------------');
L.push('# GOOGLE_CLOUD_PROJECT is the "ADC is available in this process" signal the');
L.push('# server utils key off. In-pod the chart sets it; locally YOU set it.');
L.push(`GOOGLE_CLOUD_PROJECT=${gcpProject}`);

if (bigquery.enabled) {
    L.push('');
    L.push('# --- BigQuery: DIRECT via your ADC ------------------------------------------');
    L.push('# Requires roles/bigquery.jobUser (jobs.create) + read on the dataset.');
    L.push('NUXT_PUBLIC_BIGQUERY_ENABLED=true');
    L.push(`NUXT_PUBLIC_BIGQUERY_PROJECT_ID=${bigquery.project_id || gcpProject}`);
    L.push(`NUXT_PUBLIC_BIGQUERY_DATASET_ID=${bigquery.dataset_id || 'bctenant_analytics'}`);
    L.push(`NUXT_PUBLIC_BIGQUERY_LOCATION=${bigquery.location || 'US'}`);
}

if (firestore.enabled) {
    L.push('');
    L.push('# --- Firestore prefs: DIRECT via your ADC -----------------------------------');
    L.push('# getFirestoreDb() falls back to applicationDefault() when no SA key is');
    L.push('# injected, so this needs only roles/datastore.user for your identity.');
    L.push('NUXT_PUBLIC_FIRESTORE_ENABLED=true');
    L.push(`NUXT_PUBLIC_FIRESTORE_PROJECT_ID=${firestore.project_id || gcpProject}`);
    L.push(`NUXT_PUBLIC_FIRESTORE_DATABASE_ID=${firestore.database_id || '(default)'}`);
}

if (cloudSql.enabled) {
    let conn = cloudSql.connection_name;
    if (!conn && gcpProject) {
        conn = resolveConnNameLocally(gcpProject, slug);
        if (conn) {
            console.log(`  (resolved Cloud SQL connection name locally via gcloud: ${conn})`);
        }
    }
    const iamUser = cloudSql.iam_user || (runtimeGsa ? runtimeGsa.replace(/\.gserviceaccount\.com$/, '') : '');
    L.push('');
    L.push('# --- Cloud SQL: DIRECT via the Cloud SQL Auth Proxy, IMPERSONATING the');
    L.push('#     runtime GSA (same component AND same identity as the in-pod sidecar) ---');
    L.push('# db.ts reads the SAME env trio the Helm chart renders in-pod. Connecting');
    L.push('# as the runtime GSA means its existing table grants apply — no GRANTs.');
    L.push('#');
    L.push('# One-time:  roles/iam.serviceAccountTokenCreator on the runtime GSA, plus');
    L.push('#            cloudsql.client + cloudsql.instanceUser (grant-local-dev-access).');
    L.push('# Run the proxy in another terminal (leave it running):');
    if (conn && runtimeGsa) {
        L.push('#   cloud-sql-proxy --auto-iam-authn \\');
        L.push(`#     --impersonate-service-account=${runtimeGsa} \\`);
        L.push(`#     --port ${cloudSqlPort} ${conn}`);
    } else {
        L.push('#   (connection_name not resolved yet — re-run `npm run bridge` once Cloud SQL warms up)');
    }
    if (conn) L.push(`CLOUD_SQL_CONNECTION_NAME=${conn}`);
    if (iamUser) L.push(`CLOUD_SQL_IAM_USER=${iamUser}`);
    L.push(`CLOUD_SQL_DATABASE=${cloudSql.database || 'bctenant'}`);
    L.push(`CLOUD_SQL_PORT=${cloudSqlPort}`);
}

// Agent — run the ADK api_server LOCALLY (the in-cluster agent isn't reachable
// from a laptop). Mirrors the GKE transport contract; the app doesn't care the
// api_server is on localhost vs in-cluster.
const agentBaseUrl = agent.base_url_hint || 'http://127.0.0.1:8080';
L.push('');
L.push('# --- Agent: run the ADK api_server LOCALLY (the real agent-dev story) -------');
L.push('# The DEPLOYED in-cluster agent is NOT reachable from a laptop (private GKE');
L.push('# control plane). So run it locally — better anyway: edit agents/ and hit it');
L.push('# immediately, with Vertex models + Elemental tools via your ADC + the');
L.push('# tenant gateway key. The app\'s `gke` transport works the same on localhost.');
L.push('#');
L.push('# One-time: agents/.venv with deps —');
L.push('#   cd agents && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt');
L.push('# Run it (leave running; needs aiplatform access on the model project):');
L.push('#   GOOGLE_GENAI_USE_VERTEXAI=1 GOOGLE_CLOUD_PROJECT=broadchurch \\');
L.push('#     GOOGLE_CLOUD_LOCATION=us-central1 \\');
L.push('#     agents/.venv/bin/adk api_server --host 127.0.0.1 --port 8080 agents');
L.push('NUXT_PUBLIC_AGENT_HOSTING=gke');
L.push(`NUXT_AGENT_BASE_URL=${agentBaseUrl}`);
if (queryServerUrl) {
    L.push('');
    L.push(`# Query Server (informational; the app reaches it via the gateway proxy): ${queryServerUrl}`);
}
L.push('');

fs.writeFileSync(OUT_PATH, L.join('\n'));

console.log(`\n✅ Wrote .env.bridge for ${slug} (${gcpProject})`);
console.log('\nNext:');
console.log(`  1. scripts/grant-local-dev-access.sh ${gcpProject}   # one-time IAM`);
console.log('  2. cat .env.bridge >> .env && npm run dev');
console.log('  3. open http://localhost:3000/tenancy-probe  → "Re-run probe"');
if (cloudSql.enabled || agentBaseUrl) {
    console.log('\nSidecars (each in its own terminal, leave running) — see the commented');
    console.log('blocks in .env.bridge for the exact cloud-sql-proxy + adk api_server commands.');
}
