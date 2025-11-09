export const DEFAULT_BOOKING_RULES = {
  publicMaxAdvanceDays: 7,
  memberMaxAdvanceDays: 14,
  memberOnlyServiceIds: [],
};

export function clampAdvanceDays(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const intVal = Math.floor(num);
  if (intVal < 0) return 0;
  if (intVal > 365) return 365;
  return intVal;
}

export function normalizeBookingRules(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_BOOKING_RULES };
  }

  const source = raw;
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

  return {
    publicMaxAdvanceDays,
    memberMaxAdvanceDays,
    memberOnlyServiceIds: ids,
  };
}

export function sanitizeBookingRulesForSave(rules) {
  const normalized = normalizeBookingRules(rules);
  return {
    publicMaxAdvanceDays: normalized.publicMaxAdvanceDays,
    memberMaxAdvanceDays: normalized.memberMaxAdvanceDays,
    memberOnlyServiceIds: normalized.memberOnlyServiceIds,
  };
}

export function isMembersOnlyService(rules, serviceId) {
  if (!rules || !serviceId) return false;
  const idStr = String(serviceId).trim();
  if (!idStr) return false;
  return (rules.memberOnlyServiceIds || []).includes(idStr);
}
