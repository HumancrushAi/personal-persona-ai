#!/usr/bin/env bash
#
# Provision the volume, then hand over to the stock worker entrypoint.
#
# Wrapping rather than replacing: the base image's start script sets up the
# ComfyUI server and the RunPod handler, and reimplementing that here would mean
# re-doing it on every base image bump. This only adds a step in front.
set -uo pipefail

bash /provision-models.sh || echo "[entrypoint] provisioning reported a problem; starting anyway"

# The base image has changed the name of this over releases, so try the known
# ones in order rather than pinning one and breaking on the next bump.
for candidate in /start.sh /entrypoint.sh /usr/local/bin/start.sh; do
  if [ -x "$candidate" ]; then
    echo "[entrypoint] handing over to $candidate"
    exec "$candidate" "$@"
  fi
done

echo "[entrypoint] no start script found in the base image — check its release notes" >&2
exit 1
