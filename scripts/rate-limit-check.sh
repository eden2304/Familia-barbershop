#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
ENDPOINT="${ENDPOINT:-/auth/request-code-login}"
PHONE="${PHONE:-0500000000}"

printf "Using API_URL=%s ENDPOINT=%s\n" "$API_URL" "$ENDPOINT"

hit() {
  local ip="$1"
  curl -s -o /dev/null -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: ${ip}" \
    -d "{\"phone\": \"${PHONE}\"}" \
    "${API_URL}${ENDPOINT}"
}

printf "\nBurst from IP 1.1.1.1 (should eventually 429 for strict endpoints):\n"
for i in $(seq 1 25); do
  code=$(hit "1.1.1.1")
  printf "%02d -> %s\n" "$i" "$code"
  sleep 0.1
  if [[ "$code" == "429" ]]; then
    echo "Received 429 as expected for strict endpoint."
    break
  fi
done

printf "\nSame burst from a different IP 2.2.2.2 (should have its own bucket):\n"
for i in $(seq 1 10); do
  code=$(hit "2.2.2.2")
  printf "%02d -> %s\n" "$i" "$code"
  sleep 0.1
done

printf "\nStatic GET check (should stay 200/304 and not rate-limit easily):\n"
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Forwarded-For: 3.3.3.3" \
    "${API_URL}/products")
  printf "%02d -> %s\n" "$i" "$code"
  sleep 0.05
done
