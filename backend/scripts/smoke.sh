#!/usr/bin/env bash
set -e

BASE="${BASE:-http://localhost:3001}"
DATE=$(date -v+1d +"%Y-%m-%d" 2>/dev/null || date -d "tomorrow" +%F)

echo "=== Smoke test against $BASE (date=$DATE) ==="

echo "[1] GET /services"
SVCS=$(curl -s "$BASE/services")
echo "$SVCS" | jq .
SERVICE_ID=$(echo "$SVCS" | jq -r '.[0].id')
if [ -z "$SERVICE_ID" ] || [ "$SERVICE_ID" = "null" ]; then
  echo "No services found. Exiting."
  exit 1
fi
echo "Using serviceId=$SERVICE_ID"

echo "[2] GET /appointments/available"
AVAIL=$(curl -s "$BASE/appointments/available?serviceId=$SERVICE_ID&date=$DATE")
echo "$AVAIL" | jq .
FIRST_SLOT=$(echo "$AVAIL" | jq -r '.[0] // empty')
if [ -z "$FIRST_SLOT" ] || [ "$FIRST_SLOT" = "null" ]; then
  echo "No available slots to book. Exiting."
  exit 0
fi
echo "Using first available slot: $FIRST_SLOT"

echo "[3] POST /appointments (book $FIRST_SLOT)"
BOOK=$(curl -s -X POST "$BASE/appointments" \
  -H "Content-Type: application/json" \
  -d '{
    "clientPhone": "0500000000",
    "clientFirstName": "לקוח",
    "clientLastName": "בדיקה",
    "serviceId": "'$SERVICE_ID'",
    "startsAt": "'$DATE'T'"$FIRST_SLOT"':00+03:00"
  }')
echo "$BOOK" | jq .

echo "[4] GET /clients/me/appointments"
curl -s "$BASE/clients/me/appointments?phone=0500000000" | jq .

echo "[5] POST /admin/blocked-times (10:30-12:00)"
BT=$(curl -s -X POST "$BASE/admin/blocked-times" \
  -H "Content-Type: application/json" \
  -d '{
    "startAt": "'$DATE'T10:30:00+03:00",
    "endAt": "'$DATE'T12:00:00+03:00",
    "reason": "סגירה לניקיון"
  }')
echo "$BT" | jq .
BLOCK_ID=$(echo "$BT" | jq -r '.id // empty')

echo "[6] GET /admin/blocked-times"
curl -s "$BASE/admin/blocked-times" | jq .

echo "[7] GET /appointments/available (after block)"
curl -s "$BASE/appointments/available?serviceId=$SERVICE_ID&date=$DATE" | jq .

if [ -n "$BLOCK_ID" ] && [ "$BLOCK_ID" != "null" ]; then
  echo "[8] DELETE /admin/blocked-times/$BLOCK_ID (cleanup)"
  curl -s -X DELETE "$BASE/admin/blocked-times/$BLOCK_ID" | jq .
fi

echo "=== Done ==="
