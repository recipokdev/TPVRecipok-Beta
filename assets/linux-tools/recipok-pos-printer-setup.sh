#!/usr/bin/env bash
set -euo pipefail

# Crea/actualiza una cola RAW "target" (RECIPOK_POS) apuntando al DeviceURI de una impresora CUPS existente ("from")
# Uso:
#   sudo ./recipok-pos-printer-setup.sh --target RECIPOK_POS --from "POS-80"

TARGET="RECIPOK_POS"
FROM=""

log(){ echo "[recipok-pos] $*"; }
die(){ echo "[recipok-pos] ERROR: $*" >&2; exit 1; }

need_root(){
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    die "Run as root (use sudo / pkexec)."
  fi
}

parse_args(){
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target)
        shift; [[ $# -gt 0 ]] || die "--target requires a value"
        TARGET="$1"; shift;;
      --from)
        shift; [[ $# -gt 0 ]] || die "--from requires a value"
        FROM="$1"; shift;;
      -h|--help)
        sed -n '1,120p' "$0"; exit 0;;
      *)
        die "Unknown arg: $1";;
    esac
  done

  [[ -n "$TARGET" ]] || die "Missing --target"
  [[ -n "$FROM" ]]   || die "Missing --from"
}

ensure_cups(){
  if ! command -v lpadmin >/dev/null 2>&1; then
    log "Installing CUPS (cups)"
    apt-get update -y
    apt-get install -y cups
  fi
}

enable_filedevice(){
  local f="/etc/cups/cups-files.conf"
  [[ -f "$f" ]] || die "CUPS config not found at $f (is cups installed?)"

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
    systemctl restart cups || systemctl restart cups.service
  else
    log "Restarting CUPS (service)"
    service cups restart
  fi
}

resolve_from_printer_uri(){
  # Devuelve el Device URI exacto de la impresora "FROM" tal como lo conoce CUPS
  # Ejemplo salida lpstat:
  #   device for POS-80: usb://...
  local uri=""
  uri="$(lpstat -v "$FROM" 2>/dev/null | sed -n 's/^device for .*: //p' | head -n 1 || true)"

  if [[ -z "${uri:-}" ]]; then
    # fallback: buscar en todo lpstat -v por si el nombre difiere por mayúsculas/espacios
    uri="$(lpstat -v 2>/dev/null | sed -n "s/^device for ${FROM//\//\\/}:[[:space:]]*//p" | head -n 1 || true)"
  fi

  if [[ -z "${uri:-}" ]]; then
    log "Printers known by CUPS:"
    lpstat -p 2>/dev/null || true
    die "Could not resolve device URI for CUPS printer: '$FROM'"
  fi

  echo "$uri"
}

create_or_update_queue(){
  local uri="$1"
  [[ -n "$uri" ]] || die "Empty URI"

  log "Creating/updating RAW queue '$TARGET' -> $uri"
  lpadmin -p "$TARGET" -E -v "$uri" -m raw

  cupsenable "$TARGET" || true
  cupsaccept "$TARGET" || true

  log "Queue ready: $TARGET"
}

main(){
  need_root
  parse_args "$@"
  ensure_cups
  enable_filedevice
  restart_cups

  local uri
  uri="$(resolve_from_printer_uri)"
  log "Resolved URI from '$FROM' -> $uri"

  create_or_update_queue "$uri"
}

main "$@"