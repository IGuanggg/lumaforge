#!/bin/sh
set -e

# Ensure persistent directory structure exists
DATA="${CLOUD_CONFIG_DB:-/app/data/cloud_config.db}"
mkdir -p "$(dirname "$DATA")"

exec "$@"
