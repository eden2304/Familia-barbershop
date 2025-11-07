#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
PHONE_REG="${PHONE_REG:-0508887777}"     # טלפון לרישום
PHONE_LOGIN="${PHONE_LOGIN:-0508887777}" # אותו טלפון להתחברות
FIRST_NAME="${FIRST_NAME:-Eden}"
LAST_NAME="${LAST_NAME:-Tester}"
CODE="${CODE:-1111}"

# IMPORTANT: עדכן SERVICE_ID לשירות אמיתי מה-DB/מה-API
SERVICE_ID="${SERVICE_ID:-<PUT-YOUR-SERVICE-ID>}"

# קבע תאריך מחר בפורמט YYYY-MM-DD (תואם ל-macOS ול-Linux)
if date -v+1d +%F >/dev/null 2>&1; then
  DATE="$(date -v+1d +%F)"
  PAST_DATE="$(date -v-1d +%F)"
else
  DATE="$(date -d '+1 day' +%F)"
  PAST_DATE="$(date -d '-1 day' +%F)"
fi

hr() { echo "------------------------------------------------------------"; }

call() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  echo
  echo "$method $path"
  if [[ "$method" == "GET" || -z "$data" ]]; then
    curl -sS -i -X "$method" "$BASE$path" \
      -H "Content-Type: application/json" | sed 's/\r$//'
  else
    curl -sS -i -X "$method" "$BASE$path" \
      -H "Content-Type: application/json" \
      -d "$data" | sed 's/\r$//'
  fi
  echo
}

need_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "⚠️  jq לא מותקן. כדי לבחור סלוט אוטומטית, התקן jq או תן ידנית SLOT=HH:MM לפני ההרצה."
  fi
}

hr
echo "🔎 1) זמינות ליום ${DATE} ושירות ${SERVICE_ID}"
call GET "/appointments/available?serviceId=${SERVICE_ID}&date=${DATE}"

hr
echo "📝 2) בקשת קוד לרישום"
call POST "/auth/request-code" "{\"phone\":\"$PHONE_REG\"}"

hr
echo "👤 3) רישום משתמש חדש"
call POST "/auth/register" "{\"phone\":\"$PHONE_REG\",\"code\":\"$CODE\",\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\"}"

hr
echo "🔐 4) בקשת קוד להתחברות (צריך להצליח כי כבר רשום)"
call POST "/auth/request-code-login" "{\"phone\":\"$PHONE_LOGIN\"}"

hr
echo "✅ 5) אימות קוד"
call POST "/auth/verify-code" "{\"phone\":\"$PHONE_LOGIN\",\"code\":\"$CODE\"}"

# מצא סלוט פנוי
need_jq
if command -v jq >/dev/null 2>&1; then
  SLOT="$(curl -s "$BASE/appointments/available?serviceId=${SERVICE_ID}&date=${DATE}" | jq -r '.[0] // empty')"
else
  SLOT="${SLOT:-}" # אפשר להעביר מבחוץ: SLOT=10:00 ./scripts/backend_appointments_smoke.sh
fi

if [[ -z "${SLOT:-}" ]]; then
  echo "⚠️  לא נמצאו סלוטים פנויים ל-${DATE}. עדכן DATE/BusinessHours או הגדר ידנית SLOT=HH:MM."
  exit 1
fi
echo "נבחר סלוט: $SLOT"

hr
echo "📅 6) יצירת תור תקין"
call POST "/appointments" "{\"serviceId\":\"$SERVICE_ID\",\"date\":\"$DATE\",\"time\":\"$SLOT\",\"client\":{\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\",\"phone\":\"$PHONE_LOGIN\"}}"

hr
echo "⛔ 7) ניסיון חפיפה באותו הסלוט (צפוי 409)"
call POST "/appointments" "{\"serviceId\":\"$SERVICE_ID\",\"date\":\"$DATE\",\"time\":\"$SLOT\",\"client\":{\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\",\"phone\":\"$PHONE_LOGIN\"}}"

hr
echo "⛔ 8) ניסיון אינטרוול לא מיושר (לדוגמה 07:05, צפוי 400 NOT_ALIGNED_TO_INTERVAL או OUT_OF_BUSINESS_HOURS)"
call POST "/appointments" "{\"serviceId\":\"$SERVICE_ID\",\"date\":\"$DATE\",\"time\":\"07:05\",\"client\":{\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\",\"phone\":\"$PHONE_LOGIN\"}}"

hr
echo "⛔ 9) ניסיון מחוץ לשעות פעילות (לדוגמה 06:00, צפוי 403 OUT_OF_BUSINESS_HOURS)"
call POST "/appointments" "{\"serviceId\":\"$SERVICE_ID\",\"date\":\"$DATE\",\"time\":\"06:00\",\"client\":{\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\",\"phone\":\"$PHONE_LOGIN\"}}"

hr
echo "⛔ 10) ניסיון הזמנה לעבר (${PAST_DATE}, צפוי 403 CANNOT_BOOK_PAST)"
call POST "/appointments" "{\"serviceId\":\"$SERVICE_ID\",\"date\":\"$PAST_DATE\",\"time\":\"10:00\",\"client\":{\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\",\"phone\":\"$PHONE_LOGIN\"}}"

# חסימה סביב הסלוט שנבחר: שעה קדימה
IFS=: read -r HH MM <<< "$SLOT"
BLOCK_START="${DATE}T${HH}:${MM}:00"
BLOCK_END_HH=$(printf '%02d' $((10#${HH}+1)))
BLOCK_END="${DATE}T${BLOCK_END_HH}:${MM}:00"

hr
echo "🚫 11) יצירת חסימה ואז ניסיון לקבוע בתוכה (צפוי 409 Slot is blocked)"
call POST "/admin/blocked-times" "{\"startAt\":\"$BLOCK_START\",\"endAt\":\"$BLOCK_END\",\"reason\":\"Test block\"}"

hr
echo "⛔ ניסיון לקבוע בתוך חסימה"
call POST "/appointments" "{\"serviceId\":\"$SERVICE_ID\",\"date\":\"$DATE\",\"time\":\"$SLOT\",\"client\":{\"firstName\":\"$FIRST_NAME\",\"lastName\":\"$LAST_NAME\",\"phone\":\"$PHONE_LOGIN\"}}"

hr
echo "📜 12) ההזמנות שלי לפי טלפון"
call GET "/clients/me/appointments?phone=${PHONE_LOGIN}"

echo
echo "✅ בדיקות הסתיימו."
