#!/usr/bin/env bash
# Grant the current gcloud user the IAM roles needed to develop LOCALLY
# against a BC 2.0 tenant's own GCP project — the same data planes the
# in-cluster pod reaches via Workload Identity, but reached from your
# laptop via Application Default Credentials.
#
# In local dev YOU are the workload identity, so you need the human
# equivalent of the roles gcp-bctenant grants the tenant runtime GSAs.
# See .agents/skills/aether/local-dev-bc2.md.
#
# Usage:
#   gcloud auth login
#   gcloud auth application-default login
#   scripts/grant-local-dev-access.sh <tenant-gcp-project> [user-email]
#
# (`npm run bridge` prints the exact <tenant-gcp-project> for you.)
#
# Idempotent: add-iam-policy-binding is a no-op if the binding exists.
set -euo pipefail

PROJECT="${1:-}"
if [[ -z "$PROJECT" ]]; then
    echo "usage: $0 <tenant-gcp-project> [user-email]" >&2
    exit 2
fi

USER_EMAIL="${2:-$(gcloud config get-value account 2>/dev/null)}"
if [[ -z "$USER_EMAIL" || "$USER_EMAIL" == "(unset)" ]]; then
    echo "Could not resolve your gcloud account; pass it as the 2nd arg." >&2
    exit 2
fi

MEMBER="user:${USER_EMAIL}"

# Roles, by plane. Mirrors what gcp-bctenant grants the runtime GSAs:
#   - Firestore prefs            → datastore.user
#   - BigQuery (read + run jobs) → bigquery.jobUser + bigquery.dataViewer
#   - Cloud SQL (IAM auth)       → cloudsql.client + cloudsql.instanceUser
#   - Cloud SQL (list instances) → cloudsql.viewer, so `npm run bridge` can
#     resolve the TF-suffixed instance's connection name with your own creds
#     when the portal couldn't (see docs/BC_2_LOCAL_DEV.md).
ROLES=(
    "roles/datastore.user"
    "roles/bigquery.jobUser"
    "roles/bigquery.dataViewer"
    "roles/cloudsql.client"
    "roles/cloudsql.instanceUser"
    "roles/cloudsql.viewer"
)

echo "Granting local-dev roles on ${PROJECT} to ${MEMBER}:"
for ROLE in "${ROLES[@]}"; do
    echo "  + ${ROLE}"
    gcloud projects add-iam-policy-binding "$PROJECT" \
        --member="$MEMBER" \
        --role="$ROLE" \
        --condition=None \
        --quiet >/dev/null
done

# Cloud SQL is reached by IMPERSONATING the tenant runtime GSA
# (bc-aether-ui@<project>...), so you also need Token Creator ON that GSA.
# This is what lets `cloud-sql-proxy --impersonate-service-account` mint a
# token for the runtime identity (whose table grants already exist).
RUNTIME_GSA="bc-aether-ui@${PROJECT}.iam.gserviceaccount.com"
echo "  + roles/iam.serviceAccountTokenCreator on ${RUNTIME_GSA}"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_GSA" \
    --project="$PROJECT" \
    --member="$MEMBER" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --quiet >/dev/null 2>&1 || echo "    (skipped — runtime GSA not found yet, or already bound)"

echo
echo "Done. Next:"
echo "  cat .env.bridge >> .env && npm run dev"
echo "  open http://localhost:3000/tenancy-probe"
echo
echo "Cloud SQL also needs the Auth Proxy running locally, and the agent"
echo "runs as a local adk api_server — see the commented blocks in .env.bridge."
