## Manual / Local Setup

Node 20 is the baseline (pinned in `.nvmrc`). Newer versions generally work.

```bash
export AR_NPM_TOKEN="$(gcloud auth print-access-token)"  # @yottagraph-app/* is private (GCP Artifact Registry)
npm run init -- --local   # creates .env with dev defaults (no Auth0)
npm install               # public deps from npmjs; @yottagraph-app/* from Artifact Registry
npm run dev               # dev server on port 3000
```

> `@yottagraph-app/*` packages are served from the org's GCP Artifact Registry,
> not public npmjs. You need `roles/artifactregistry.reader` on
> `broadchurch/aether-npm` and an `AR_NPM_TOKEN` (the `export` above). See
> `broadchurch/docs/NPM_PRIVATE_REGISTRY.md`.

For the full interactive wizard (project name, Auth0, query server, etc.):

```bash
npm run init              # interactive, or --non-interactive for CI (see --help)
```

## Two local-dev modes — pick the right one

`npm run dev` above runs in **fallback/gateway mode**: Elemental data flows
through the portal gateway, but Firestore / BigQuery / Cloud SQL / the agent
use local fallbacks (e.g. local-FS prefs) rather than the tenant's real
planes. That's enough for UI work.

To run a **BC 2.0 tenant** (`hosting: gcp` in `broadchurch.yaml`) against
its **real per-tenant data planes**, use the bridge instead — the model is
"locally you are the workload identity," reaching each plane directly via
your `gcloud` ADC, no secrets:

```bash
npm run bridge            # portal vends the per-tenant coordinates → .env.bridge
cat .env.bridge >> .env
npm run dev
open http://localhost:3000/tenancy-probe   # → "Re-run probe" (aim for 5/5 ok)
```

Full how-to (one-time IAM grant, the Cloud SQL proxy + local `adk
api_server` sidecars, `spawn EBADF` gotcha): [local-dev-bc2.md](local-dev-bc2.md),
or run the `/bridge` command.
