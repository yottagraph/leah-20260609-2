### App (Nuxt UI + server routes)

Which substrate you're on is set by the `hosting:` field in
`broadchurch.yaml`. Check it before assuming a deploy path.

- **GKE-hosted (BC 2.0, `hosting: gcp`):** pushing to `main` triggers
  `deploy-ui.yml`, which builds the image and updates the per-tenant GKE
  Deployment via GitOps. There is **no Vercel project** — don't wait for a
  Vercel deploy. Available at the tenant's public URL.
- **Vercel-hosted (legacy BC 1.0, `hosting: vercel` or unset):** Vercel
  auto-deploys on every push to `main`; preview deployments are created for
  other branches. Available at `{slug}.yottagraph.app`.

### Agents (`agents/`)

Each subdirectory in `agents/` is a self-contained Python ADK agent.
**Pushing to `main` auto-deploys** via `deploy-agent.yml` (it triggers on
`agents/**`), so a `git push` is enough — you do _not_ need `gh workflow run`.
You can also deploy via the Portal UI or `/deploy_agent` in Cursor.

### MCP Servers (`mcp-servers/`)

Each subdirectory in `mcp-servers/` is a Python FastMCP server. Deploy via
the Portal UI or `/deploy_mcp` in Cursor.

### Compute Jobs (`jobs/`) and Workflows (`workflows/`)

Each subdirectory in `jobs/` is a Cloud Run Job (or K8s Job on the
per-tenant GKE cluster when `runner: k8s_job` is set in `job.yaml`).
Each subdirectory in `workflows/` is a Cloud Workflow that orchestrates
jobs into a DAG. The platform's `deploy-job.yml` is `workflow_dispatch`-only
by design, but the template ships `auto-deploy-jobs.yml`, which **re-deploys
a job automatically when `jobs/<name>/**`changes on a push to`main`** — so,
like agents and the UI, a plain `git push`is the redeploy lever. You can
also deploy via the Portal UI or`/deploy_job`/`/deploy_workflow`. See
[`compute.md`](compute.md) for patterns and `job.yaml` reference.

### `broadchurch.yaml` `agents:` / `jobs:` keys

After provisioning, `broadchurch.yaml`'s `agents:` and `jobs:` maps are
empty (`{}`). **You don't populate them by hand** — the deploy workflows
register each agent/job there automatically when it first deploys. Leaving
them empty is correct; the deploy still works.

### Redeploying as a cloud agent (no `gh workflow run`)

Cloud build agents run `gh` in read-only mode and can't `gh workflow run`.
That's fine: **push-to-deploy is the sanctioned redeploy lever** for the UI
(`deploy-ui.yml`), agents (`deploy-agent.yml`), and jobs
(`auto-deploy-jobs.yml`) — they all trigger on a push to `main`. A normal
commit that touches the relevant path redeploys; you only hit the read-only
`gh` wall when you want to _re-run an unchanged_ deploy (a flaky retry),
which still needs a human `/deploy_*`.

### Rollout timing & confirming a deploy

A green deploy workflow means the image was built and the manifest updated —
**not** that the new code is serving yet. Typical lags after the workflow
reports success:

- **UI Deployment (ArgoCD reconcile):** ~2-5 min.
- **Agent Deployment:** ~3-8 min.
- **Cloud SQL provisioning (first time):** ~5-15 min (warms independently).

To confirm the new image is actually serving — instead of guessing — poll
**`GET /api/_version`** on the live site. It returns `started_at` (the
serving pod's boot time — flips to a recent value once the rollout lands),
`git_sha` / `image` / `built_at` when the pipeline injects them, and
`db: { configured, mode, reachable }` (a bounded `SELECT 1`, so
`reachable: true` means Cloud SQL is warm). When `started_at` is newer than
your push and `db.reachable` is `true`, the tenant is ready.
