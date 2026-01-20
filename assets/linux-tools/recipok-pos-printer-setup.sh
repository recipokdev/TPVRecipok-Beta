#!/usr/bin/env bash
set -euo pipefail

# Recipok POS - Setup CUPS RAW queue pointing to an existing CUPS printer by name
# Usage:
#   sudo ./recipok-pos-printer-setup.sh --from "POS-80" --target "RECIPOK_POS"
#
# What it does:
# - Ensures CUPS exists
# - Enables FileDevice (harmless even if not needed)
# - Resolves device URI from: lpstat -v "<FROM_PRINTER>"
# - Creates/updates RAW queue TARGET pointing to that URI
# - Enables & accepts the TARGET queue

FROM_PRINTER=""
TARGET_QUEUE="RECIPOK_POS"

log(){ echo "[recipok-pos] $*"; }
die(){ echo "[recipok-pos] ERROR: $*" >&2; exit 1; }

need_root(){
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    die "Run as root (use pkexec/sudo)."
  fi
}

parse_args(){
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from)
        shift; [[ $# -gt 0 ]] || die "--from requires a value"
        FROM_PRINTER="$1"; shift
        ;;
      --target)
        shift; [[ $# -gt 0 ]] || die "--target requires a value"
        TARGET_QUEUE="$1"; shift
        ;;
      -h|--help)
        sed -n '1,120p' "$0"; exit 0
        ;;
      *)
        die "Unknown arg: $1"
        ;;
    esac
  done

  [[ -n "$FROM_PRINTER" ]] || die "Missing --from <printerName> (e.g. --from \"POS-80\")"
  [[ -n "$TARGET_QUEUE" ]] || die "Missing --target <queueName>"
}

ensure_cups(){
  if ! command -v lpadmin >/dev/null 2>&1; then
    log "Installing CUPS (cups)"
    apt-get update -y
    apt-get install -y cups
  fi
}

enable_filedevice(){
  # Some setups need FileDevice for file:/dev/usb/lpX. For usb:// it is not required, but harmless.
  local f="/etc/cups/cups-files.conf"
  if [[ ! -f "$f" ]]; then
    log "cups-files.conf not found at $f (skipping FileDevice tweak)"
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

resolve_from_printer_uri(){
  # Works in ANY locale because we just take everything after the last ':'
  # Example outputs:
  #   device for POS-80: usb://...
  #   dispositivo para POS-80: usb://...
  local line uri
  line="$(lpstat -v "$FROM_PRINTER" 2>/dev/null || true)"

  if [[ -z "${line:-}" ]]; then
    die "CUPS printer not found: '$FROM_PRINTER'. Check: lpstat -v"
  fi

  # Extract after the last colon + spaces
  uri="$(echo "$line" | sed -n 's/^.*:[[:space:]]*//p' | head -n 1 | tr -d '\r' )"

  if [[ -z "${uri:-}" ]]; then
    die "Could not resolve device URI for CUPS printer: '$FROM_PRINTER' (lpstat -v parse failed)"
  fi

  log "Resolved URI for '$FROM_PRINTER' -> $uri"
  echo "$uri"
}

create_or_update_queue(){
  local uri="$1"

  log "Creating/updating RAW queue '$TARGET_QUEUE' -> $uri"

  # raw model: ensures no filtering; good for ESC/POS via -o raw on lp
  lpadmin -p "$TARGET_QUEUE" -E -v "$uri" -m raw

  cupsenable "$TARGET_QUEUE" || true
  cupsaccept "$TARGET_QUEUE" || true

  # Ensure source printer is enabled too (some systems mark it inactive)
  cupsenable "$FROM_PRINTER" 2>/dev/null || true
  cupsaccept "$FROM_PRINTER" 2>/dev/null || true

  log "Queue ready: $TARGET_QUEUE"
}

main(){
  need_root
  parse_args "$@"
  ensure_cups
  enable_filedevice
  restart_cups
  local uri
  uri="$(resolve_from_printer_uri)"
  create_or_update_queue "$uri"
  log "OK ✅"
}

main "$@"