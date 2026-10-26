#!/usr/bin/env bash
#
# Keeps the volume's models in line with a list the app controls, so trying a
# new model is an edit to that list rather than an image rebuild plus a manual
# pod edit. The pod has no terminal; this is the only way in.
#
# The list (HC_MODEL_LIST_URL) is plain text, one entry per line:
#   get|<folder>|<file name>|<https://huggingface.co/... url>
#   del|<folder>|<file name>
# Folders are limited to the model folders below and names to plain file
# names, so the list can only ever add or remove model files.
#
# It writes what it sees, the volume's free space included, to ComfyUI's input
# folder, where /view?type=input&filename=hc-sync-status.txt serves it.
set -uo pipefail

VOL="${VOL:-/runpod-volume}"
MODELS="$VOL/models"
LIST_URL="${HC_MODEL_LIST_URL:-https://bhjnfsqbocyfczpbxtrz.supabase.co/storage/v1/object/public/avatars/worker/models.txt}"
STATUS_DIR="${HC_STATUS_DIR:-/comfyui/input}"
INTERVAL="${HC_MODEL_SYNC_INTERVAL:-180}"
[ -d "$VOL" ] || { echo "[sync] no volume at $VOL"; exit 0; }

log() { echo "$(date -u +%H:%M:%S) $*" >> /tmp/model-sync.log; }

valid() {
  case "$1" in checkpoints|unet|clip|vae|loras|controlnet) ;; *) return 1 ;; esac
  [[ "$2" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.(safetensors|pt|pth|bin)$ ]] || return 1
}

fetch() {
  local url="$1" dest="$2"
  [ -s "$dest" ] && return 0
  [[ "$url" == https://huggingface.co/* ]] || { log "! refused url $url"; return 1; }
  log "+ $(basename "$dest")"
  local auth=()
  [ -n "${HF_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $HF_TOKEN")
  if curl -fsSL --retry 5 --retry-delay 10 -C - "${auth[@]}" -o "$dest.part" "$url"; then
    if [ "$(stat -c%s "$dest.part" 2>/dev/null || echo 0)" -ge 1000000 ]; then
      mv "$dest.part" "$dest"; log "✓ $(basename "$dest")"
    else
      rm -f "$dest.part"; log "! $(basename "$dest") was an error page"
    fi
  else
    log "! failed (progress kept) $(basename "$dest")"
  fi
}

status() {
  {
    echo "updated $(date -u +%FT%TZ)"
    df -h "$VOL" | tail -1
    echo "--- files"
    find "$MODELS" -type f \( -name '*.safetensors' -o -name '*.part' \) -printf '%s %P\n' 2>/dev/null \
      | awk '{ printf "%7.1fGB %s\n", $1/1e9, $2 }' | sort -k2
    echo "--- log"
    tail -20 /tmp/model-sync.log 2>/dev/null
  } > "$STATUS_DIR/hc-sync-status.txt.tmp" && mv "$STATUS_DIR/hc-sync-status.txt.tmp" "$STATUS_DIR/hc-sync-status.txt"
}

# Status every minute on its own, so a long download still shows progress.
( while true; do status; sleep 60; done ) &

while true; do
  list=$(curl -fsSL -m 30 "$LIST_URL?t=$(date +%s)" 2>/dev/null || true)
  while IFS='|' read -r op dir name url; do
    op="${op//[$'\r ']/}"; url="${url//[$'\r ']/}"
    [ -z "$op" ] || [[ "$op" == \#* ]] && continue
    valid "$dir" "$name" || { log "! skipped entry $dir/$name"; continue; }
    mkdir -p "$MODELS/$dir"
    case "$op" in
      get) fetch "$url" "$MODELS/$dir/$name" ;;
      del) if [ -e "$MODELS/$dir/$name" ] || [ -e "$MODELS/$dir/$name.part" ]; then
             rm -f "$MODELS/$dir/$name" "$MODELS/$dir/$name.part"; log "- $dir/$name"
           fi ;;
    esac
  done <<< "$list"
  sleep "$INTERVAL"
done
