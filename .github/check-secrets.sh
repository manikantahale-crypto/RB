#!/usr/bin/env bash
# Fail if a credential-shaped string is committed.
#
# Scans tracked files only — what is in the working tree but ignored is not our
# problem; what is in git is. Run from the repository root:
#
#   bash .github/check-secrets.sh
#
# Wired into CI. Keep the allowlist tight: every entry is a promise
# that the match is genuinely not a secret.
set -uo pipefail

PATTERN='(postgres(ql)?://[^ "'"'"']*:[^ @"'"'"']+@|^[^#]*(password|passwd|secret|api[_-]?key)[[:space:]]*=[[:space:]]*[^[:space:]$"'"'"']|sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{30,})'

# Known-safe: local dev hosts, documented placeholders, type declarations.
ALLOW='localhost|127\.0\.0\.1|test:test|USER:PASSWORD|<your|example\.com|\$\{|process\.env|passwordLength'

hits=$(git grep -nIE "$PATTERN" -- . ':!package-lock.json' ':!*.lock' 2>/dev/null \
       | grep -vE "$ALLOW" || true)

if [ -n "$hits" ]; then
  echo "FAIL — credential-shaped strings found in tracked files:"
  echo "$hits"
  echo
  echo "Move the value to .env (gitignored) or the environment, then rotate it —"
  echo "anything already pushed must be treated as compromised."
  exit 1
fi

echo "OK — no credential-shaped strings in tracked files."
