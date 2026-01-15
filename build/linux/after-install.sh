#!/usr/bin/env bash
set -euo pipefail

RULE_SRC="/opt/TPV Recipok/resources/assets/udev/99-tpvrecipok-cashdrawer.rules"
RULE_DST="/etc/udev/rules.d/99-tpvrecipok-cashdrawer.rules"

# Copiar regla udev si existe en resources
if [ -f "$RULE_SRC" ]; then
  cp -f "$RULE_SRC" "$RULE_DST"
  chmod 644 "$RULE_DST"
fi

# Recargar reglas udev
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload-rules || true
  udevadm trigger || true
fi

exit 0