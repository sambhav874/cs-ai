#!/usr/bin/env bash
# setup-github-deployer.sh — provision a dedicated GCP service account
# that GitHub Actions will use to deploy. Run once locally; never again.
#
# What it does:
#   1. Creates the 'github-deployer' service account in the current GCP
#      project (the one selected by your local gcloud config).
#   2. Grants it ONLY the roles needed to:
#        - build + deploy Cloud Run services
#        - act as the cr-api and cr-agents runtime SAs (least privilege)
#        - push container images to Artifact Registry
#        - deploy to Firebase Hosting
#      (No secret-accessor, no project-wide IAM admin, no Owner.)
#   3. Generates a JSON key and writes it to ./github-deployer-key.json.
#   4. Prints the exact GitHub secrets you need to add.
#
# Usage:
#   ./scripts/setup-github-deployer.sh
#
# After the script finishes:
#   - Add the four printed secrets to your GitHub repo
#     (Settings → Secrets and variables → Actions → New repository secret).
#   - DELETE the local key file once it's pasted into GitHub.

set -euo pipefail

PROJECT_ID="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: No gcloud project set. Run: gcloud config set project <id>" >&2
  exit 1
fi

SA_NAME="github-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/github-deployer-key.json"

echo "═════════════════════════════════════════════════════════════════"
echo "  Setting up GitHub Actions deployer SA"
echo "  Project: $PROJECT_ID"
echo "  SA:      $SA_EMAIL"
echo "═════════════════════════════════════════════════════════════════"
echo

# ─── 1. create the service account ────────────────────────────────────
if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "✓ Service account $SA_NAME already exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --project "$PROJECT_ID" \
    --display-name "GitHub Actions deployer" \
    --description "Used by .github/workflows/deploy.yml to deploy on push to main"
  echo "✓ Created $SA_NAME"
fi

# ─── 2. grant project-wide roles needed by gcloud + firebase ─────────
PROJECT_ROLES=(
  roles/run.admin                          # deploy + manage Cloud Run services
  roles/cloudbuild.builds.editor           # trigger Cloud Build for --source deploys
  roles/storage.admin                      # Cloud Build staging buckets
  roles/artifactregistry.writer            # push container images
  roles/firebasehosting.admin              # firebase hosting deploys + rollback
  roles/firebase.viewer                    # let the firebase CLI list projects
)

for role in "${PROJECT_ROLES[@]}"; do
  echo "  granting $role …"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None \
    --quiet \
    >/dev/null
done
echo "✓ Project-wide roles bound"

# ─── 3. grant act-as on the runtime SAs (least privilege) ────────────
# The deployer must be able to "act as" the runtime SAs (cr-api,
# cr-agents) so it can pass them to `gcloud run deploy --service-account`.
# We bind this on the runtime SA itself rather than project-wide.
for runtime_sa in cr-api cr-agents; do
  target_email="${runtime_sa}@${PROJECT_ID}.iam.gserviceaccount.com"
  if gcloud iam service-accounts describe "$target_email" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts add-iam-policy-binding "$target_email" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role="roles/iam.serviceAccountUser" \
      --project "$PROJECT_ID" \
      --condition=None \
      --quiet \
      >/dev/null
    echo "✓ Deployer can act as $runtime_sa"
  else
    echo "  (skipped $runtime_sa — runtime SA does not exist yet; run deploy.sh once first)"
  fi
done

# ─── 4. mint a JSON key ───────────────────────────────────────────────
# Rotate this key any time it leaks. Old keys can be deleted with:
#   gcloud iam service-accounts keys list --iam-account=$SA_EMAIL
#   gcloud iam service-accounts keys delete <KEY_ID> --iam-account=$SA_EMAIL
echo
echo "→ Minting key → $KEY_FILE"
rm -f "$KEY_FILE"
gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account "$SA_EMAIL" \
  --project "$PROJECT_ID"

chmod 600 "$KEY_FILE"

# ─── 5. instruct the operator ─────────────────────────────────────────
echo
echo "═════════════════════════════════════════════════════════════════"
echo "  Add these FOUR repository secrets in GitHub:"
echo "  (Settings → Secrets and variables → Actions → New)"
echo "═════════════════════════════════════════════════════════════════"
echo
echo "  Name:  GCP_PROJECT_ID"
echo "  Value: $PROJECT_ID"
echo
echo "  Name:  GCP_SA_KEY"
echo "  Value: <paste the ENTIRE content of $KEY_FILE — it's a JSON blob>"
echo
echo "  Name:  SMOKE_ADMIN_EMAIL"
echo "  Value: admin@demo.com  (or whatever you've changed it to)"
echo
echo "  Name:  SMOKE_ADMIN_PASSWORD"
echo "  Value: password123  (or whatever you've changed it to)"
echo
echo "═════════════════════════════════════════════════════════════════"
echo "  After pasting, DELETE the local key file:"
echo "    rm $KEY_FILE"
echo "═════════════════════════════════════════════════════════════════"
