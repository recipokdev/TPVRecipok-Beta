#!/usr/bin/env bash
set -euo pipefail

# Recipok POS printer setup (Ubuntu/CUPS)
# Crea/actualiza una cola RAW estable (TARGET) clonando el device-uri desde una impresora existente (FROM).
#
# Uso:
#   sudo ./recipok-pos-printer-setup.sh --target RECIPOK_POS --from "POS-80"
#
# Nota:
# - Esto NO depende del idioma del sistema.
# - Extrae el URI exacto desde: lpstat -v <FROM>
# - Si el URI resultara ser file:/dev/usb/lpX, habilita FileDevice automáticamente.

TARGET="RECIPOK_POS"
FROM=""
URI=""

log(){ echo "[recipok-pos] $*"; }
die(){ echo "[recipok-pos] ERROR: $*" >&2; exit 1; }

need_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    die "Ejecuta como root (usa sudo/pkexec)."
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target) shift; [[ $# -gt 0 ]] || die "--target requiere valor"; TARGET="$1"; shift ;;
      --from)   shift; [[ $# -gt 0 ]] || die "--from requiere valor"; FROM="$1"; shift ;;
      --uri)    shift; [[ $# -gt 0 ]] || die "--uri requiere valor"; URI="$1"; shift ;;
      -h|--help)
        cat <<EOF
Uso:
  sudo $0 --target RECIPOK_POS --from "POS-80"
  sudo $0 --target RECIPOK_POS --uri "usb://Printer/POS-80?serial=XXXX"

EOF
        exit 0
        ;;
      *) die "Argumento desconocido: $1" ;;
    esac
  done
}

ensure_cups() {
  if ! command -v lpadmin >/dev/null 2>&1; then
    log "Instalando CUPS (cups)..."
    apt-get update -y
    apt-get install -y cups
  fi
}

enable_filedevice_if_needed() {
  # Solo si vamos a usar backend file:
  [[ "$URI" == file:* ]] || return 0

  local f="/etc/cups/cups-files.conf"
  [[ -f "$f" ]] || die "No existe $f (¿cups instalado?)"

  if grep -Eq '^[[:space:]]*FileDevice[[:space:]]+Yes' "$f"; then
    log "FileDevice ya estaba habilitado."
    return 0
  fi

  log "Habilitando FileDevice en $f (necesario para file:/dev/usb/lpX)"
  if grep -Eq '^[[:space:]]*#?[[:space:]]*FileDevice[[:space:]]+' "$f"; then
    sed -ri 's/^[[:space:]]*#?[[:space:]]*FileDevice[[:space:]]+.*/FileDevice Yes/' "$f"
  else
    printf '\n# Added by Recipok POS setup\nFileDevice Yes\n' >> "$f"
  fi

  restart_cups
}

restart_cups() {
  if command -v systemctl >/dev/null 2>&1; then
    log "Reiniciando CUPS..."
    systemctl restart cups || systemctl restart cups.service
  else
    log "Reiniciando CUPS (service)..."
    service cups restart
  fi
}

resolve_from_printer_uri() {
  if [[ -n "${URI:-}" ]]; then
    log "Usando URI explícito: $URI"
    return 0
  fi

  [[ -n "${FROM:-}" ]] || die "Falta --from o --uri"

  # lpstat -v "<FROM>" devuelve una línea tipo:
  #   device for POS-80: usb://Printer/POS-80?serial=...
  # o en español:
  #   dispositivo para POS-80: usb://Printer/POS-80?serial=...
  #
  # Importante: NO usar cut -d: porque rompe "usb://"
  local line
  if ! line="$(lpstat -v "$FROM" 2>/dev/null | head -n 1)"; then
    die "No pude consultar lpstat para '$FROM'. ¿Existe esa impresora en CUPS?"
  fi

  # Quita TODO hasta ": " (o ":<espacios>") y deja el resto intacto (incluye usb://...)
  URI="$(echo "$line" | sed -E 's/^.*:[[:space:]]*//')"

  if [[ -z "${URI:-}" || "$URI" == "$line" ]]; then
    die "No pude extraer el device-uri desde: $line"
  fi

  log "Resolved URI para '$FROM' -> $URI"
}

create_or_update_queue() {
  log "Creando/actualizando cola RAW '$TARGET' -> $URI"

  # Cola RAW (warning deprecado puede aparecer, pero sigue funcionando en muchas distros)
  lpadmin -p "$TARGET" -E -v "$URI" -m raw

  cupsenable "$TARGET" || true
  cupsaccept "$TARGET" || true

  log "OK. Cola lista: $TARGET"
  log "Prueba:  printf 'TEST\\n\\x1D\\x56\\x42\\x60' | lp -d $TARGET -o raw"
}

main() {
  need_root
  parse_args "$@"
  ensure_cups

  # Flujo recomendado:
  # ensure_cups
  # resolve_from_printer_uri
  # enable_filedevice_if_needed (solo si URI empieza por file:)
  # create_or_update_queue
  resolve_from_printer_uri
  enable_filedevice_if_needed
  create_or_update_queue
}

main "$@"