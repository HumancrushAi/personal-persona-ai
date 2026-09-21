#!/usr/bin/env bash
#
# Install one ComfyUI custom node pack.
#
# One pack per invocation, so each is its own Docker layer and its own line in a
# build failure. The whole node install used to be a single RUN, which meant a
# failure anywhere in it produced an annotation quoting sixty lines of shell and
# naming nothing — four builds were spent reading logs to find out which step
# had failed.
#
# Reads COMFY_DIR and PY from /etc/hc-build.env, written by the discovery step.
set -euo pipefail

repo="${1:?usage: install-node.sh <owner/repo>}"
# shellcheck disable=SC1091
. /etc/hc-build.env

name="${repo#*/}"
dest="$COMFY_DIR/custom_nodes/$name"

echo "=== $name ==="
git clone --depth 1 "https://github.com/$repo.git" "$dest"

req="$dest/requirements.txt"
if [ ! -f "$req" ]; then
  echo "no requirements.txt; nothing to install"
  exit 0
fi

# Requirements pulled from a VCS are dropped.
#
# Impact Pack pins git+https://github.com/facebookresearch/sam2, which fails
# while building its own build dependencies and took the entire image down with
# it. SAM2 drives SAM-based masking; the FaceID graph uses FaceDetailer with the
# Ultralytics detector and never loads it.
#
# Both lists are printed. A dependency dropped silently is a node that fails at
# import six steps later with nothing to connect it to.
vcs='^[[:space:]]*(git\+|-e[[:space:]]|https?://)'
{ grep -vE "$vcs" "$req" || true; } > /tmp/req.txt
echo "--- installing ---"; cat /tmp/req.txt
echo "--- skipped (from a vcs) ---"; { grep -E "$vcs" "$req" || true; }

# A node pack's own requirements are not fatal. They pin loosely and reach for
# packages this graph never touches. insightface and numpy are installed
# separately and DO fail the build, because the graph cannot work without them.
if ! "$PY" -m pip install --no-cache-dir -r /tmp/req.txt; then
  echo "WARN: some requirements for $name did not install; continuing"
fi
