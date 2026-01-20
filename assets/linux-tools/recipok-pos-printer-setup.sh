#!/usr/bin/env bash
set -euo pipefail

# Recipok POS printer setup (Ubuntu/Linux + CUPS)
#
# Goal:
# - User selects a real CUPS printer by name (e.g., "POS-80", "XP-80", "EPSON_TM_T20")
# - This script creates/updates a stable RAW queue: RECIPOK_POS
# - RECIPOK_POS points to the same DeviceURI as the chosen printer
#
# Usage:
#   sudo ./recipok-pos-printer-setup.sh --from "POS-80"
#   sudo ./recipok-pos-printer-setup.sh --from "XP-80" --target "RECIPOK_POS"
#
# Notes:
# - Requires CUPS installed.
# - Enables FileDevice in cups-files.conf (harmless even if not used).
# - Works even if the chosen printer uses usb://, ipp://, socket://, etc.

TARGET_QUEUE="RECIPOK_POS"
FROM_PRINTER=""

log(){ echo "[recipok-pos] $*"; }
die(){ echo "[recipok-pos] ERROR: $*" >&2; exit 1; }

need_root(){
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    die "Run as root (pkexec/sudo)."
  fi
}

parse_args(){
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target|--name)
        shift; [[ $# -gt 0 ]] || die "$1 requires a value"
        TARGET_QUEUE="$1"; shift ;;
      --from)
        shift; [[ $# -gt 0 ]] || die "--from requires a value"
        FROM_PRINTER="$1"; shift ;;
      -h|--help)
        cat <<EOF
Usage:
  sudo $0 --from "<CUPS_PRINTER_NAME>" [--target "RECIPOK_POS"]

Examples:
  sudo $0 --from "POS-80"
  sudo $0 --from "XP-80" --target "RECIPOK_POS"
EOF
        exit 0 ;;
      *)
        # If someone passes a positional printer name, accept it as --from.
        if [[ -z "$FROM_PRINTER" ]]; then
          FROM_PRINTER="$1"; shift
        else
          die "Unknown arg: $1"
        fi
        ;;
    esac
  done
}

ensure_cups(){
  if ! command -v lpadmin >/dev/null 2>&1; then
    log "Installing CUPS (cups)..."
    apt-get update -y
    apt-get install -y cups
  fi
}

enable_filedevice(){
  # Not strictly required for USB URI printers, but safe and helps some setups.
  local f="/etc/cups/cups-files.conf"
  if [[ ! -f "$f" ]]; then
    log "cups-files.conf not found at $f (some distros use a different path). Skipping FileDevice."
    return 0
  fi

  if grep -Eq '^[[:space:]]*FileDevice[[:space:]]+Yes' "$f"; then
    log "FileDevice already enabled."
    return 0
  fi

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
    systemctl restart cups || systemctl restart cups.service || true
  else
    log "Restarting CUPS (service)"
    service cups restart || true
  fi
}

resolve_device_uri(){
  [[ -n "$FROM_PRINTER" ]] || die "Missing --from <printerName>"

  if ! command -v lpstat >/dev/null 2>&1; then
    die "lpstat not found (cups missing?)"
  fi

  # Expected: "device for PRINTER: URI"
  local line uri
  line="$(lpstat -v "$FROM_PRINTER" 2>/dev/null || true)"
  [[ -n "$line" ]] || die "Printer not found in CUPS: $FROM_PRINTER"

  uri="$(echo "$line" | sed -n 's/^device for .*: //p' | head -n1)"
  [[ -n "$uri" ]] || die "Could not resolve DeviceURI for: $FROM_PRINTER"

  echo "$uri"
}

create_or_update_queue(){
  local uri="$1"
  log "Creating/updating RAW queue '$TARGET_QUEUE' -> $uri"

  # -m raw sets "raw" model/PPD.
  # This is key for ESC/POS RAW printing.
  lpadmin -p "$TARGET_QUEUE" -E -v "$uri" -m raw

  cupsenable "$TARGET_QUEUE" || true
  cupsaccept "$TARGET_QUEUE" || true

  log "Queue ready: $TARGET_QUEUE"
}

main(){
  need_root
  parse_args "$@"
  ensure_cups
  enable_filedevice
  restart_cups

  local uri
  uri="$(resolve_device_uri)"
  create_or_update_queue "$uri"
}

main "$@"