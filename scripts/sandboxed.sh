#!/bin/sh
# Runs a command inside scripts/build.sb. Refuses to run unsandboxed rather than silently doing so.
set -eu
if ! command -v sandbox-exec >/dev/null 2>&1; then
  echo "sandbox-exec not found: refusing to run third-party build tools unsandboxed." >&2
  exit 1
fi
exec sandbox-exec -D "HOME=$HOME" -D "PROJECT=$(pwd -P)" -f scripts/build.sb "$@"
