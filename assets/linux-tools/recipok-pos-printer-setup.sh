#!/usr/bin/env bash
set -euo pipefail

# Recipok POS printer one-time setup for Ubuntu (CUPS RAW queue for ESC/POS thermal printers)
# - Enables FileDevice in CUPS (needed for file:/dev/usb/lpX backends)
# - Creates/updates a RAW queue with a stable name
# - Tries to auto-detect the USB printer device (/dev/usb/lp*)
#
# Usage:
#   sudo ./recipok-pos-printer-setup.sh                # auto-detect /dev/usb/lp*
#   sudo ./recipok-pos-printer-setup.sh /dev/usb/lp1   # explicit device
#   sudo ./recipok-pos-printer-setup.sh --name RECIPOK_POS --device /dev/usb/lp1
#
# Notes:
# - Run once per machine (or again if USB device changes)
# - After this, print from Electron using: lp -d <QUEUE_NAME> -o raw

QUEUE_NAME="RECIPOK_POS"
DEVICE=""

log(){ echo "[recipok-pos] $*"; }
die(){ echo "[recipok-pos] ERROR: $*" >&2; exit 1; }

need_root(){
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    die "Run as root (use sudo)."
  fi
}

parse_args(){
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)
        shift; [[ $# -gt 0 ]] || die "--name requires a value"; QUEUE_NAME="$1"; shift ;;
      --device)
        shift; [[ $# -gt 0 ]] || die "--device requires a value"; DEVICE="$1"; shift ;;
      -h|--help)
        sed -n '1,120p' "$0"; exit 0 ;;
      *)
        # allow passing device as first positional
        if [[ -z "$DEVICE" ]]; then DEVICE="$1"; shift; else die "Unknown arg: $1"; fi
        ;;
    esac
  done
}

enable_filedevice(){
  local f="/etc/cups/cups-files.conf"
  [[ -f "$f" ]] || die "CUPS config not found at $f (is cups installed?)"

  # If FileDevice is already Yes, do nothing.
  if grep -Eq '^[[:space:]]*FileDevice[[:space:]]+Yes' "$f"; then
    log "FileDevice already enabled."
    return 0
  fi

  # Prefer to replace an existing FileDevice line (commented or not).
  if grep -Eq '^[[:space:]]*#?[[:space:]]*FileDevice[[:space:]]+' "$f"; then
    log "Enabling FileDevice in $f"
    sed -ri 's/^[[:space:]]*#?[[:space:]]*FileDevice[[:space:]]+.*/FileDevice Yes/' "$f"
  else
    log "Adding FileDevice Yes to $f"
    printf '\n# Added by Recipok POS setup\nFileDevice Yes\n' >> "$f"
  fi
}

restart_cups(){
  if command -v systemctl >/dev/null 2>&1; then
    log "Restarting CUPS"
    systemctl restart cups || systemctl restart cups.service
  else
    log "Restarting CUPS (service)"
    service cups restart
  fi
}

ensure_cups(){
  if ! command -v lpadmin >/dev/null 2>&1; then
    log "Installing CUPS (cups)"
    apt-get update -y
    apt-get install -y cups
  fi
}

autodetect_device(){
  if [[ -n "$DEVICE" ]]; then
    [[ -e "$DEVICE" ]] || die "Device not found: $DEVICE"
    return 0
  fi

  # Prefer /dev/usb/lp* devices if present.
  if compgen -G "/dev/usb/lp*" > /dev/null; then
    # Pick the highest-numbered device (often the most recent attach)
    DEVICE=$(ls -1 /dev/usb/lp* 2>/dev/null | sort -V | tail -n 1)
    log "Auto-detected device: $DEVICE"
    return 0
  fi

  # Fallback: try CUPS device discovery
  if command -v lpinfo >/dev/null 2>&1; then
    local usb_uri
    usb_uri=$(lpinfo -v 2>/dev/null | awk '/usb:/{print $2; exit}') || true
    if [[ -n "${usb_uri:-}" ]]; then
      log "Found USB URI via lpinfo: $usb_uri"
      log "This script currently expects /dev/usb/lpX. Plug the printer via USB and ensure /dev/usb/lpX exists."
    fi
  fi

  die "Could not auto-detect /dev/usb/lp*. Is the printer connected and powered?"
}

create_or_update_queue(){
  log "Creating/updating RAW queue '$QUEUE_NAME' -> file:$DEVICE"

  # (Re)create idempotently: lpadmin updates if it exists.
  lpadmin -p "$QUEUE_NAME" -E -v "file:$DEVICE" -m raw

  cupsenable "$QUEUE_NAME" || true
  cupsaccept "$QUEUE_NAME" || true

  log "Queue ready: $QUEUE_NAME"
  log "Test print:  printf 'TEST\\n\\x1D\\x56\\x42\\x60' | lp -d $QUEUE_NAME -o raw"
}

main(){
  need_root
  parse_args "$@"
  ensure_cups
  enable_filedevice
  restart_cups
  autodetect_device
  create_or_update_queue
}

main "$@"
