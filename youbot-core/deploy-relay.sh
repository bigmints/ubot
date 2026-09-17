#!/bin/bash
# Deploy the shared multi-tenant Youbot relay to Google Cloud Run.

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELAY_DIR="$SCRIPT_DIR/webchat-relay"
PROJECT="${GCP_PROJECT:-youbot-live}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE_NAME="${GCP_SERVICE:-youbot}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://youbot.live}"
SIGNING_SECRET="${RELAY_SIGNING_SECRET:-}"
SIGNING_SECRET_REF="${RELAY_SIGNING_SECRET_REF:-}"
SIGNING_SECRET_NAME="${RELAY_SIGNING_SECRET_NAME:-}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-europe-west1}"
SERVICE_ACCOUNT_NAME="${RELAY_SERVICE_ACCOUNT:-youbot-relay}"
TEMP_FILES=()
TEMP_DIRS=()

cleanup() {
  local temporary
  for temporary in "${TEMP_FILES[@]}"; do
    rm -f -- "$temporary"
  done
  for temporary in "${TEMP_DIRS[@]}"; do
    rm -rf -- "$temporary"
  done
}
trap cleanup EXIT

for command_name in gcloud node openssl curl mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --public-url) PUBLIC_BASE_URL="${2%/}"; shift 2 ;;
    --signing-secret) SIGNING_SECRET="$2"; shift 2 ;;
    --signing-secret-name) SIGNING_SECRET_NAME="$2"; shift 2 ;;
    --firestore-location) FIRESTORE_LOCATION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

SIGNING_SECRET_NAME="${SIGNING_SECRET_NAME:-${SERVICE_NAME}-relay-signing-secret}"

if [[ -z "$PROJECT" ]]; then
  echo "No Google Cloud project is configured."
  exit 1
fi

if [[ ! -d "$RELAY_DIR" ]]; then
  echo "Relay directory not found: $RELAY_DIR"
  exit 1
fi

echo "Preparing Google Cloud services in $PROJECT"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  iam.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT"

if ! gcloud firestore databases describe \
  --database='(default)' \
  --project "$PROJECT" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database='(default)' \
    --location="$FIRESTORE_LOCATION" \
    --type=firestore-native \
    --project "$PROJECT"
fi

gcloud firestore fields ttls update expireAt \
  --collection-group=messages \
  --database='(default)' \
  --enable-ttl \
  --async \
  --project "$PROJECT" \
  --quiet >/dev/null

SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT_NAME@$PROJECT.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" \
  --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name="Youbot webchat relay" \
    --project "$PROJECT"
fi

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/datastore.user" \
  --condition=None \
  --quiet >/dev/null

# Preserve the signing secret on repeat deployments. Changing it invalidates
# every issued relay URL and bot credential.
if [[ -z "$SIGNING_SECRET" && -z "$SIGNING_SECRET_REF" ]]; then
  EXISTING_SERVICE_JSON="$(mktemp)"
  TEMP_FILES+=("$EXISTING_SERVICE_JSON")
  if gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT" \
    --region "$REGION" \
    --format=json > "$EXISTING_SERVICE_JSON" 2>/dev/null; then
    SIGNING_SECRET="$(node -e '
      const fs = require("node:fs");
      const service = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const env = service?.spec?.template?.spec?.containers?.[0]?.env || [];
      process.stdout.write(env.find((item) => item.name === "RELAY_SIGNING_SECRET")?.value || "");
    ' "$EXISTING_SERVICE_JSON")"
    SIGNING_SECRET_REF="$(node -e '
      const fs = require("node:fs");
      const service = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const env = service?.spec?.template?.spec?.containers?.[0]?.env || [];
      const ref = env.find((item) => item.name === "RELAY_SIGNING_SECRET")?.valueFrom?.secretKeyRef;
      if (ref?.name) process.stdout.write(`${ref.name}:${ref.key || "latest"}`);
    ' "$EXISTING_SERVICE_JSON")"
  fi
  rm -f "$EXISTING_SERVICE_JSON"
fi

if [[ -z "$SIGNING_SECRET" && -z "$SIGNING_SECRET_REF" ]]; then
  SIGNING_SECRET="$(openssl rand -hex 32)"
fi

if [[ -n "$SIGNING_SECRET" && ${#SIGNING_SECRET} -lt 32 ]]; then
  echo "Relay signing secret must contain at least 32 characters." >&2
  exit 1
fi

# Never pass the signing secret as a plain Cloud Run environment value. New
# secrets and legacy plain values are placed in Secret Manager first.
if [[ -z "$SIGNING_SECRET_REF" ]]; then
  if ! gcloud secrets describe "$SIGNING_SECRET_NAME" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$SIGNING_SECRET_NAME" --replication-policy=automatic --project "$PROJECT"
  fi
  SECRET_FILE="$(mktemp)"
  TEMP_FILES+=("$SECRET_FILE")
  printf '%s' "$SIGNING_SECRET" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  gcloud secrets versions add "$SIGNING_SECRET_NAME" --data-file="$SECRET_FILE" --project "$PROJECT" >/dev/null
  SIGNING_SECRET_REF="$SIGNING_SECRET_NAME:latest"
  unset SIGNING_SECRET
fi

SECRET_RESOURCE="${SIGNING_SECRET_REF%%:*}"
gcloud secrets add-iam-policy-binding "$SECRET_RESOURCE" \
  --project "$PROJECT" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

echo "Deploying Youbot relay"
echo "Project: $PROJECT"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Public URL: $PUBLIC_BASE_URL"

# Package the relay with the canonical repository-root installer. Cloud Run's
# source build otherwise cannot read files outside webchat-relay.
BUILD_CONTEXT="$(mktemp -d)"
TEMP_DIRS+=("$BUILD_CONTEXT")
cp -R "$RELAY_DIR"/. "$BUILD_CONTEXT"/
install -m 755 "$SCRIPT_DIR/../install.sh" "$BUILD_CONTEXT/install.sh"

DEPLOY_ENV_ARGS=(
  --update-env-vars "NODE_ENV=production,RELAY_STORAGE=firestore,PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
  --update-secrets "RELAY_SIGNING_SECRET=$SIGNING_SECRET_REF"
)

gcloud run deploy "$SERVICE_NAME" \
  --source "$BUILD_CONTEXT" \
  --project "$PROJECT" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --service-account "$SERVICE_ACCOUNT_EMAIL" \
  "${DEPLOY_ENV_ARGS[@]}" \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 80 \
  --timeout 300 \
  --port 8080

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT" \
  --region "$REGION" \
  --format='value(status.url)')"

curl -fsS "$SERVICE_URL/health"
echo
echo "Relay deployment is healthy: $SERVICE_URL"
echo "Tenant links will use: $PUBLIC_BASE_URL/{uniqueId}"
