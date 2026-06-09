# Bridge — run this BC 2.0 tenant locally against its real data planes

One-shot setup for local dev against a BC 2.0 tenant's own per-tenant data
planes (Elemental Query Server, Firestore prefs, BigQuery, Cloud SQL,
agent). The model: locally **you are the workload identity** — every plane
is reached via your `gcloud` Application Default Credentials, no secrets.

Full background: read [local-dev-bc2.md](../skills/aether/local-dev-bc2.md)
in the `aether` skill before running this.

**Prerequisite:** a `broadchurch.yaml` at the repo root (written at provision
time). This flow only applies to BC 2.0 (`hosting: gcp`) tenants with
per-tenant GCP capabilities.

---

## Step 1: Confirm ADC is present

The bridge authenticates as the human via Application Default Credentials.

```bash
gcloud auth application-default print-access-token >/dev/null 2>&1 \
  && echo "ADC OK" || echo "ADC MISSING"
```

**If MISSING**, tell the user to run, then stop:

```bash
gcloud auth login
gcloud auth application-default login
```

---

## Step 2: Generate `.env.bridge`

```bash
npm run bridge
```

This reads `broadchurch.yaml` (org_id + gateway + the non-secret
`qs_api_key`), calls the portal's `GET /api/v2/projects/{org}/local-dev-bridge`,
and writes `.env.bridge` with the per-tenant coordinates that carry random
Terraform suffixes (GCP project id, Cloud SQL connection name, runtime GSA).

Capture the **GCP project id** it prints — Step 3 needs it.

**If it fails** because the project isn't resolvable yet, the tenant is
still provisioning — wait a few minutes and re-run. Surface any
`warnings[]` the portal returned to the user.

---

## Step 3: Grant your identity the per-plane IAM roles (one-time)

```bash
scripts/grant-local-dev-access.sh <gcp-project-id>
```

Idempotent. Grants the human equivalent of the runtime GSA's roles plus
Token Creator on the runtime GSA (for the Cloud SQL proxy impersonation).

---

## Step 4: Apply the bridge and start the dev server

```bash
cat .env.bridge >> .env
npm run dev
```

---

## Step 5: Print the two sidecar commands

Cloud SQL and the agent each need a local helper process. Read the
commented blocks of the generated `.env.bridge` and surface the two ready
commands to the user (this tenant's project / connection name / runtime GSA
are already filled in):

1. **Cloud SQL Auth Proxy** — `cloud-sql-proxy --auto-iam-authn --impersonate-service-account=… --port 5432 <connection-name>`
2. **ADK `api_server`** — `agents/.venv/bin/adk api_server --host 127.0.0.1 --port 8080 agents` (after creating `agents/.venv`)

Tell the user to run each in its own terminal and leave them running.

---

## Step 6: Verify

> Open **http://localhost:3000/tenancy-probe** and click **Re-run probe**.
>
> Each plane should read `✅ ok`. `unconfigured`/`fallback` means the bridge
> var for that plane isn't applied; `error` usually means the resource is
> still warming up (re-run in a minute).

If `npm run dev` crashed with `spawn EBADF`, it's the watcher crawling
`agents/.venv` — see [something-broke.md](../skills/aether/something-broke.md).
