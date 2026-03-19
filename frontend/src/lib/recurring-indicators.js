import { compareAsc } from "date-fns";

export function getAppointmentDate(appointment) {
  const value = appointment?.startsAt ?? appointment?.starts_at ?? appointment?.startAt ?? appointment?.start_at;
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function getRecurringAppointmentId(appointment) {
  return (
    appointment?.recurringId
    ?? appointment?.recurring_id
    ?? appointment?.recurringScheduleId
    ?? appointment?.recurring_schedule_id
    ?? null
  );
}

function normalizeServiceKey(appointment) {
  const serviceId = appointment?.service?.id ?? appointment?.service_id ?? appointment?.serviceId ?? null;
  const serviceName = appointment?.service?.name ?? appointment?.service_name ?? appointment?.serviceName ?? '';
  if (serviceId !== null && serviceId !== undefined && `${serviceId}`.trim()) return `id:${serviceId}`;
  if (serviceName.trim()) return `name:${serviceName.trim()}`;
  return null;
}

function getClientRecurringSchedules(client) {
  if (!client || typeof client !== 'object') return [];
  const recurring = client?.recurringAppointments ?? client?.recurring_appointments ?? client?.recurring ?? [];
  return Array.isArray(recurring) ? recurring : [];
}

export function findNextFutureRecurringAppointment(appointments, client = null) {
  const now = Date.now();
  const list = Array.isArray(appointments) ? appointments : [];
  const futureAppointments = list
    .filter((appointment) => {
      const startsAt = getAppointmentDate(appointment);
      const status = String(appointment?.status ?? '').toLowerCase();
      return Boolean(startsAt && startsAt.getTime() > now && status !== 'canceled');
    })
    .sort((a, b) => compareAsc(getAppointmentDate(a), getAppointmentDate(b)));

  if (!futureAppointments.length) return null;

  const explicitRecurring = futureAppointments.find((appointment) => Boolean(getRecurringAppointmentId(appointment)));
  if (explicitRecurring) return explicitRecurring;

  const recurringSchedules = getClientRecurringSchedules(client);
  if (recurringSchedules.length > 0) {
    const recurringServiceKeys = new Set(
      recurringSchedules
        .map((schedule) => {
          const serviceId = schedule?.service_id ?? schedule?.serviceId ?? null;
          const serviceName = schedule?.service_name ?? schedule?.serviceName ?? '';
          if (serviceId !== null && serviceId !== undefined && `${serviceId}`.trim()) return `id:${serviceId}`;
          if (serviceName.trim()) return `name:${serviceName.trim()}`;
          return null;
        })
        .filter(Boolean)
    );

    const matchFromSchedules = futureAppointments.find((appointment) => recurringServiceKeys.has(normalizeServiceKey(appointment)));
    if (matchFromSchedules) return matchFromSchedules;
  }

  const countsByService = new Map();
  for (const appointment of futureAppointments) {
    const key = normalizeServiceKey(appointment);
    if (!key) continue;
    countsByService.set(key, (countsByService.get(key) || 0) + 1);
  }

  return futureAppointments.find((appointment) => {
    const key = normalizeServiceKey(appointment);
    return key ? (countsByService.get(key) || 0) >= 2 : false;
  }) || null;
}

export function hasFutureRecurringAppointment(appointments, client = null) {
  return Boolean(findNextFutureRecurringAppointment(appointments, client));
}
