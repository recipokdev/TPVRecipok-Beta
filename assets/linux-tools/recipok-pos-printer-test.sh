#!/usr/bin/env bash
set -euo pipefail

QUEUE="${1:-RECIPOK_POS}"

# Init + texto + corte
printf "\x1B\x40PRUEBA RECIPOK\n----------------\nOK\n\n\x1D\x56\x42\x60" \
  | lp -d "$QUEUE" -o raw