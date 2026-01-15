#!/usr/bin/env bash
set -euo pipefail

# Intentar localizar resources aunque cambie el nombre o ruta
APP_DIR=""
for d in "/opt/TPV Recipok" "/opt/tpvrecipok" "/opt/TPVRecipok"; do
  if [ -d "$d/resources" ]; then APP_DIR="$d"; break; fi
done

# Si no se encontró, salir sin romper instalación
if [ -z "$APP_DIR" ]; then
  exit 0
fi

RULE_SRC="$APP_DIR/resources/assets/udev/99-tpvrecipok-cashdrawer.rules"
RULE_DST="/etc/udev/rules.d/99-tpvrecipok-cashdrawer.rules"

if [ -f "$RULE_SRC" ]; then
  cp -f "$RULE_SRC" "$RULE_DST"
  chmod 644 "$RULE_DST"
fi

if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload-rules || true
  udevadm trigger || true
fi

exit 0
