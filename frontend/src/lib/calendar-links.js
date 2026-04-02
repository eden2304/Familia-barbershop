const BUSINESS_NAME = "Familia Barbershop";

const pad = (value) => String(value).padStart(2, "0");

const toUtcDateString = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

const sanitizeIcsText = (text = "") =>
  String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const inferEnd = (startAt, endAt, fallbackMinutes = 45) => {
  if (endAt) return new Date(endAt);
  return new Date(new Date(startAt).getTime() + fallbackMinutes * 60 * 1000);
};

const buildGoogleCalendarUrl = ({ title, startAt, endAt, description = "", location = "" }) => {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toUtcDateString(startAt)}/${toUtcDateString(endAt)}`,
    details: description,
    location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

const buildIcsContent = ({ title, startAt, endAt, description = "", location = "" }) => {
  const timestamp = toUtcDateString(new Date());
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Familia//Appointments//HE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@familia-barbershop`,
    `DTSTAMP:${timestamp}`,
    `DTSTART:${toUtcDateString(startAt)}`,
    `DTEND:${toUtcDateString(endAt)}`,
    `SUMMARY:${sanitizeIcsText(title)}`,
    `DESCRIPTION:${sanitizeIcsText(description)}`,
    `LOCATION:${sanitizeIcsText(location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
};

const isAppleDevice = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchPoints = navigator.maxTouchPoints || 0;

  const iOS = /iPhone|iPad|iPod/i.test(ua);
  const iPadOS = platform === "MacIntel" && touchPoints > 1;
  return iOS || iPadOS;
};

const downloadIcsFile = (icsContent, filename = "familia-appointment.ics") => {
  if (typeof document === "undefined") return;
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};

export const openAddToCalendar = ({
  title = "תור ב-Familia",
  startAt,
  endAt,
  description = "התור שלך במספרת Familia",
  location = BUSINESS_NAME,
  fallbackDurationMinutes = 45,
}) => {
  if (!startAt) return;
  const safeStart = new Date(startAt);
  const safeEnd = inferEnd(safeStart, endAt, fallbackDurationMinutes);

  if (isAppleDevice()) {
    const ics = buildIcsContent({ title, startAt: safeStart, endAt: safeEnd, description, location });
    downloadIcsFile(ics);
    return;
  }

  const googleUrl = buildGoogleCalendarUrl({ title, startAt: safeStart, endAt: safeEnd, description, location });
  if (typeof window !== "undefined") {
    window.open(googleUrl, "_blank", "noopener,noreferrer");
  }
};
