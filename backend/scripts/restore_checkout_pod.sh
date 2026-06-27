#!/usr/bin/env bash
# Revert the deployment broken by break_checkout_pod.sh. Uses
# `kubectl rollout undo` (the same action the SRE agent's "rollout_undo"
# Tier-1 remediation runs) to roll back to the prior known-good revision,
# rather than guessing at the original container command.
set -euo pipefail

NAMESPACE="checkout-service"
DEPLOYMENT="checkout-service"

echo "Restoring $DEPLOYMENT in $NAMESPACE via rollout undo..."
kubectl rollout undo deployment/"$DEPLOYMENT" -n "$NAMESPACE"
kubectl rollout status deployment/"$DEPLOYMENT" -n "$NAMESPACE" --timeout=60s
echo "Restored."
