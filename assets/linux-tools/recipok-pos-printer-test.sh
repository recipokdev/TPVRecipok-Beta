#!/usr/bin/env bash
set -euo pipefail
QUEUE_NAME="${1:-RECIPOK_POS}"
# init + simple text + cut-after-feed
printf "\x1B\x40PRUEBA RECIPOK\n----------------\nOK\n\n\x1D\x56\x42\x60" | lp -d "$QUEUE_NAME" -o raw
