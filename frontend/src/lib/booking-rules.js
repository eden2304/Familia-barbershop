export const DEFAULT_BOOKING_RULES = {
  publicMaxAdvanceDays: 7,
  memberMaxAdvanceDays: 14,
  memberOnlyServiceIds: [],
  memberOnlyWindows: [],
};

export function clampAdvanceDays(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const intVal = Math.floor(num);
  if (intVal < 1) return 1;
  if (intVal > 30) return 30;
  return intVal;
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function normalizeTime(value) {
  if (!value && value !== 0) return null;
  const str = String(value).trim();
  const match = TIME_RE.exec(str);
  if (!match) return null;
  let hours = Number(match[1]);
  let minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0) hours = 0;
  if (hours > 23) hours = 23;
  if (minutes < 0) minutes = 0;
  if (minutes > 59) minutes = 59;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeMemberWindows(candidate) {
  const windows = [];

  const pushWindow = (weekday, start, end) => {
    if (weekday == null) return;
    const day = Number(weekday);
    if (!Number.isInteger(day) || day < 0 || day > 6) return;
    const startNorm = normalizeTime(start);
    const endNorm = normalizeTime(end);
    if (!startNorm || !endNorm) return;
    const startMinutes = parseInt(startNorm.slice(0, 2), 10) * 60 + parseInt(startNorm.slice(3), 10);
    const endMinutes = parseInt(endNorm.slice(0, 2), 10) * 60 + parseInt(endNorm.slice(3), 10);
    if (endMinutes <= startMinutes) return;
    const key = `${day}|${startNorm}|${endNorm}`;
    if (windows.some((w) => w.__key === key)) return;
    windows.push({ weekday: day, start: startNorm, end: endNorm, __key: key });
  };

  const explore = (value, fallbackDay) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => explore(entry, fallbackDay));
      return;
    }
    if (typeof value === "object") {
      const day = value.weekday ?? value.day ?? value.day_of_week ?? fallbackDay;
      const start = value.start ?? value.from ?? value.open ?? value.start_time ?? value.startTime;
      const end = value.end ?? value.to ?? value.close ?? value.end_time ?? value.endTime;
      if (day != null || (start != null && end != null)) {
        pushWindow(day, start, end);
        return;
      }
      Object.entries(value).forEach(([maybeDay, nested]) => {
        const parsedDay = Number.isNaN(Number(maybeDay)) ? fallbackDay : Number(maybeDay);
        explore(nested, parsedDay);
      });
      return;
    }
  };

  explore(candidate, undefined);

  windows.sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    return a.start.localeCompare(b.start);
  });

  return windows.map((win, index) => ({
    weekday: win.weekday,
    start: win.start,
    end: win.end,
    id: `${win.weekday}-${win.start}-${win.end}-${index}`,
  }));
}

export function normalizeBookingRules(raw) {
  let source = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }

  if (!source || typeof source !== "object") {
    return { ...DEFAULT_BOOKING_RULES };
  }

  const publicCandidate =
      source.publicMaxAdvanceDays ??
      source.public ??
      source.publicDays ??
      source.public_days ??
      source.regular ??
      source.nonMember ??
      source.non_member;
  const memberCandidate =
      source.memberMaxAdvanceDays ??
      source.member ??
      source.members ??
      source.memberDays ??
      source.member_days ??
      source.vip ??
      source.memberAdvanceDays ??
      source.member_advance_days;
  const listCandidate =
      source.memberOnlyServiceIds ??
      source.membersOnlyServiceIds ??
      source.memberServices ??
      source.member_services ??
      source.member_only_services ??
      source.members_only_services ??
      [];
  const windowCandidate =
      source.memberOnlyWindows ??
      source.member_only_windows ??
      source.memberWindows ??
      source.member_windows ??
      [];

  const publicMaxAdvanceDays = clampAdvanceDays(publicCandidate, DEFAULT_BOOKING_RULES.publicMaxAdvanceDays);
  const memberMaxAdvanceDays = clampAdvanceDays(memberCandidate, DEFAULT_BOOKING_RULES.memberMaxAdvanceDays);
  const ids = Array.isArray(listCandidate)
      ? Array.from(
          new Set(
              listCandidate
                  .map((value) => {
                    if (value === undefined || value === null) return null;
                    const str = String(value).trim();
                    return str.length > 0 ? str : null;
                  })
                  .filter((val) => Boolean(val))
          )
        )
      : [];
  const windows = normalizeMemberWindows(windowCandidate);

  return {
    publicMaxAdvanceDays,
    memberMaxAdvanceDays,
    memberOnlyServiceIds: ids,
    memberOnlyWindows: windows,
  };
}

export function sanitizeBookingRulesForSave(rules) {
  const normalized = normalizeBookingRules(rules);
  return {
    publicMaxAdvanceDays: normalized.publicMaxAdvanceDays,
    memberMaxAdvanceDays: normalized.memberMaxAdvanceDays,
    memberOnlyServiceIds: normalized.memberOnlyServiceIds,
    memberOnlyWindows: normalized.memberOnlyWindows.map((win) => ({
      weekday: win.weekday,
      start: win.start,
      end: win.end,
    })),
  };
}

export function isMembersOnlyService(rules, serviceId) {
  if (!rules || !serviceId) return false;
  const idStr = String(serviceId).trim();
  if (!idStr) return false;
  return (rules.memberOnlyServiceIds || []).includes(idStr);
}
