#!/bin/sh
set -e

# Ensure persistent directory structure exists (survives image upgrades)
RUNTIME="${APP_RUNTIME_DIR:-/app/userdata}"
mkdir -p "$RUNTIME/API"
mkdir -p "$RUNTIME/data/conversations"
mkdir -p "$RUNTIME/data/canvases"
mkdir -p "$RUNTIME/output"
mkdir -p "$RUNTIME/assets/input"
mkdir -p "$RUNTIME/assets/output"
mkdir -p "$RUNTIME/assets/thumbs"
mkdir -p "$RUNTIME/workflows"
mkdir -p "$RUNTIME/workflows/custom"

# Copy built-in workflows to persistent volume (skip if user already has them)
if [ -d /app/workflows ]; then
    for f in /app/workflows/*.json; do
        [ -f "$f" ] || continue
        base=$(basename "$f")
        if [ ! -f "$RUNTIME/workflows/$base" ]; then
            cp "$f" "$RUNTIME/workflows/$base"
        fi
    done
fi

exec "$@"
