#!/usr/bin/env bash
# Refresh learner/instructor docs on every canonical checkpoint tag from main.
#
# Workshop app code at each checkpoint stays unchanged. Only docs/ and README.md
# are replaced so checkout instructions match the current workshop materials.
#
# Usage (from repo root, clean working tree):
#   ./scripts/sync-checkpoint-docs.sh
#   ./scripts/sync-checkpoint-docs.sh --push   # also force-push moved tags
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PUSH=0
if [[ "${1:-}" == "--push" ]]; then
  PUSH=1
fi

TAGS=(
  checkpoint/00-setup
  checkpoint/01-base-app
  checkpoint/02-tracing
  checkpoint/03-prompt-management
  checkpoint/04-monitoring
  checkpoint/05-dataset
  checkpoint/06-experiments
  checkpoint/07-evaluation
  checkpoint/08-wrap-up
)

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree must be clean before syncing checkpoint docs." >&2
  exit 1
fi

SOURCE_REF="${SOURCE_REF:-main}"
if ! git rev-parse --verify "$SOURCE_REF" >/dev/null 2>&1; then
  echo "Missing source ref: $SOURCE_REF" >&2
  exit 1
fi

START_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/checkpoint-docs-sync.XXXXXX")"
cleanup() {
  git checkout -q "$START_BRANCH" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT

git archive "$SOURCE_REF" docs README.md | tar -x -C "$STAGE"

for tag in "${TAGS[@]}"; do
  if ! git rev-parse --verify "refs/tags/$tag" >/dev/null 2>&1; then
    echo "Missing tag: $tag" >&2
    exit 1
  fi

  echo "==> $tag"
  git checkout -q --detach "refs/tags/$tag"

  rm -rf docs
  cp -a "$STAGE/docs" .
  cp "$STAGE/README.md" README.md

  git add -A docs README.md
  if git diff --cached --quiet; then
    echo "    already in sync with $SOURCE_REF"
    continue
  fi

  git commit -q -m "$(cat <<EOF
Refresh checkpoint docs to latest workshop docs

Replaces docs/ and README.md with the current tree from ${SOURCE_REF}
so this checkpoint's instructions match main. App code at this
checkpoint is unchanged.
EOF
)"

  git tag -f "$tag" HEAD
  echo "    updated $(git rev-parse --short HEAD)"

  if [[ "$PUSH" -eq 1 ]]; then
    git push --force origin "refs/tags/$tag"
    echo "    pushed $tag"
  fi
done

echo "Done. Switched back to $START_BRANCH."
if [[ "$PUSH" -eq 0 ]]; then
  echo "Tags updated locally. Re-run with --push to publish them."
fi
