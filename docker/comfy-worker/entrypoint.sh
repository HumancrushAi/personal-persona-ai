#!/usr/bin/env bash
#
# Provision the volume, then hand over to the stock worker entrypoint.
#
# Wrapping rather than replacing: the base image's start script sets up the
# ComfyUI server and the RunPod handler, and reimplementing that here would mean
# re-doing it on every base image bump. This only adds a step in front.
set -uo pipefail

bash /provision-models.sh || echo "[entrypoint] provisioning reported a problem; starting anyway"

bash /hc-link-models.sh || echo "[entrypoint] linking FaceID models reported a problem; starting anyway"

# The 31GB toy-edit model downloads in the background, on the always-on pod
# only (SERVE_API_LOCALLY=true): serverless workers share the volume and would
# be killed mid-download, so they leave it to the pod.
if [ "${SERVE_API_LOCALLY:-}" = "true" ] || [ "${HC_PROVISION_TOY_EDIT:-}" = "on" ]; then
  nohup bash /provision-toy-edit.sh > /tmp/provision-toy-edit.log 2>&1 &
fi

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
