# Local dev against a BC 2.0 tenant's real data planes

Run this BC 2.0 tenant app **locally in Cursor** against its own per-tenant
data planes (Elemental Query Server, Firestore prefs, BigQuery, Cloud SQL
Postgres, and the ADK agent) — not mocks, the real thing.

## The model: locally, YOU are the workload identity

In production each plane is reached by the in-cluster GKE pod, which gets a
token from the GKE metadata server via Workload Identity. There is **no
service-account key** anywhere — and local dev keeps it that way. Locally
you reach the exact same planes through the exact same server-util code
paths, but the token comes from **your `gcloud` Application Default
Credentials** instead of the metadata server. For Cloud SQL you go one step
further and **impersonate the tenant runtime GSA** (`bc-aether-ui@…`) so the
DB-level grants the pod relies on apply unchanged.

So local dev needs no secrets. It needs (a) your ADC, (b) a few IAM role
bindings for your human identity, and (c) the per-tenant GCP coordinates.

## The one hard part: three coordinates aren't in `broadchurch.yaml`

Three coordinates carry random Terraform suffixes, so the tenant repo can't
compute them and they're **not** in `broadchurch.yaml`:

- the per-tenant **GCP project id** (`bc-<slug>-<suffix>`),
- the Cloud SQL **connection name** (`<project>:<region>:bc-<slug>-pg-<suffix>`),
- the **runtime GSA** to impersonate (`bc-aether-ui@<project>.iam.gserviceaccount.com`).

The Broadchurch Portal provisioned them, so it's the source of truth. The
`npm run bridge` script asks the portal for them and writes a `.env.bridge`.
(Operators can get the same payload from the `get_local_dev_bridge` MCP tool.
Platform side: `broadchurch/docs/BC_2_LOCAL_DEV.md`.)

One wrinkle on the **Cloud SQL connection name**: the portal vends it when
it's entitled to list instances in the tenant project, but for TF-era
tenants that grant isn't always in place yet. When the portal returns it
empty, `npm run bridge` falls back to resolving it with **your own
`gcloud`** (you have `cloudsql.viewer` from `grant-local-dev-access.sh`, and
you're about to impersonate the runtime GSA through the proxy anyway — same
trust boundary). Either way you get a complete `.env.bridge`.

## One-time setup

```bash
gcloud auth login
gcloud auth application-default login        # this is what supplies your ADC

npm run bridge                                # writes .env.bridge (prints the project id)
scripts/grant-local-dev-access.sh <project>  # the project id npm run bridge printed
```

`grant-local-dev-access.sh` grants your human identity the per-plane roles
the runtime GSAs have (`datastore.user`, `bigquery.jobUser` + `dataViewer`,
`cloudsql.client` + `cloudsql.instanceUser`) plus
`iam.serviceAccountTokenCreator` **on the runtime GSA** (so the Cloud SQL
proxy can impersonate it). It's idempotent.

## Apply the bridge + run

```bash
cat .env.bridge >> .env
npm run dev
```

`.env.bridge` flips each plane from the gateway/fallback transport to the
direct-via-ADC transport by setting `GOOGLE_CLOUD_PROJECT` (the "ADC is
available" signal the server utils key off) and the per-plane
`NUXT_PUBLIC_*` / `CLOUD_SQL_*` / `NUXT_AGENT_*` vars.

## Two sidecars (each in its own terminal, leave running)

Cloud SQL and the agent need a local helper process. The exact commands —
with this tenant's resolved project / connection name / runtime GSA already
filled in — are in the commented blocks of your generated `.env.bridge`:

1. **Cloud SQL Auth Proxy**, impersonating the runtime GSA:

    ```bash
    cloud-sql-proxy --auto-iam-authn \
      --impersonate-service-account=bc-aether-ui@<project>.iam.gserviceaccount.com \
      --port 5432 <project>:<region>:<instance>
    ```

2. **ADK `api_server`** — the deployed in-cluster agent is _not_ reachable
   from a laptop (private GKE control plane), so you run the agent locally.
   This is the better agent-dev loop anyway: edit `agents/`, hit it
   instantly. The app's `gke` transport doesn't care the api_server is on
   localhost vs in-cluster — same contract.

    ```bash
    cd agents && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
    GOOGLE_GENAI_USE_VERTEXAI=1 GOOGLE_CLOUD_PROJECT=broadchurch \
      GOOGLE_CLOUD_LOCATION=us-central1 \
      agents/.venv/bin/adk api_server --host 127.0.0.1 --port 8080 agents
    ```

## Verify: `/tenancy-probe`

Open `http://localhost:3000/tenancy-probe` and click **Re-run probe**. It
exercises every plane through the app's own server utils and shows, per
plane: `ok` (live round-trip), `fallback` (local-dev fallback, e.g. localfs
prefs), `unconfigured` (transport not wired in this process), or `error`
(configured but the round-trip failed — usually a warming-up resource).

Do the A/B to confirm the bridge is doing something: probe **before**
applying `.env.bridge` (planes show `unconfigured`/`fallback`/gateway), then
**after** (planes flip to `ok` on the direct transport). Goal: 5/5 `ok`.

## ⚠️ EBADF gotcha

Once you've created `agents/.venv` for the agent sidecar, `npm run dev` can
die on startup with `spawn EBADF` — the Nuxt/Vite watcher crawls the ~18k
files in the venv and exhausts file descriptors. The template's
`nuxt.config.ts` already ignores `agents/`; if you hit this, confirm that
ignore is present (see [something-broke.md](something-broke.md)). It's an
environmental FD limit, not a code regression.

## Teardown

Nothing to tear down server-side — local dev created no cloud resources.
Stop the two sidecars (Ctrl-C), and optionally remove the bridge lines from
`.env` (or just delete `.env` and re-run `npm run init -- --local`). The IAM
bindings from `grant-local-dev-access.sh` are harmless to leave; revoke with
the matching `gcloud projects remove-iam-policy-binding` calls if you want.
