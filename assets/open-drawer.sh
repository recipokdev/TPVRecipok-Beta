#!/usr/bin/env bash
set -euo pipefail

# Uso:
# open-drawer.sh [device] [pin] [t1] [t2]
# device: opcional (ej: /dev/usb/lp0 o /dev/ttyUSB0)
# pin: 0/1
# t1/t2: 0..255

DEVICE="${1:-}"
PIN="${2:-0}"
T1="${3:-25}"
T2="${4:-250}"

# Validación mínima
if [[ "$PIN" != "0" && "$PIN" != "1" ]]; then PIN="0"; fi
if (( T1 < 0 || T1 > 255 )); then T1=25; fi
if (( T2 < 0 || T2 > 255 )); then T2=250; fi

# Si no te dan device, intentamos encontrar uno
if [[ -z "$DEVICE" ]]; then
  if compgen -G "/dev/usb/lp*" > /dev/null; then
    DEVICE="$(ls /dev/usb/lp* | head -n 1)"
  elif compgen -G "/dev/ttyUSB*" > /dev/null; then
    DEVICE="$(ls /dev/ttyUSB* | head -n 1)"
  elif compgen -G "/dev/ttyACM*" > /dev/null; then
    DEVICE="$(ls /dev/ttyACM* | head -n 1)"
  else
    echo "No se encontró device (/dev/usb/lp* ni /dev/ttyUSB* ni /dev/ttyACM*)" >&2
    exit 3
  fi
fi

if [[ ! -e "$DEVICE" ]]; then
  echo "El device no existe: $DEVICE" >&2
  exit 4
fi

# Construimos ESC p m t1 t2: 1B 70 PIN T1 T2
# printf con \x1b\x70 y bytes decimales
CMD="$(printf '\x1b\x70')"
# append bytes via printf octal
CMD+=$(printf "\\$(printf '%03o' "$PIN")")
CMD+=$(printf "\\$(printf '%03o' "$T1")")
CMD+=$(printf "\\$(printf '%03o' "$T2")")

# Enviamos al device
# (si es /dev/tty* podría requerir configuración de baudrate; probamos directo)
printf "%b" "$CMD" > "$DEVICE"

echo "OK"