#!/usr/bin/env bash
# Intentionally trigger CrashLoopBackOff on checkout-service in AKS, so the
# SRE agent's Tier-1 auto-remediation can be tested against a real incident.
#
# Overrides the container command to immediately exit 1 on every start --
# Kubernetes will retry with exponential backoff, surfacing as
# status.containerStatuses[].state.waiting.reason == "CrashLoopBackOff"
# within ~30-60s.
#
# Restore with: ./restore_checkout_pod.sh
set -euo pipefail

NAMESPACE="checkout-service"
DEPLOYMENT="checkout-service"

echo "Breaking $DEPLOYMENT in $NAMESPACE: overriding container command to force a crash loop..."
kubectl patch deployment "$DEPLOYMENT" -n "$NAMESPACE" --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/command","value":["sh","-c","echo BROKEN_FOR_TESTING; exit 1"]}]'

echo "Patch applied. Watch with:"
echo "  kubectl get pods -n $NAMESPACE -w"
echo "Restore with:"
echo "  ./restore_checkout_pod.sh"
