import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSystemPopup } from "@/components/SystemPopupProvider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Admin } from "@/api/entities";
import { Ban, CalendarDays, Clock3, Pencil, Plus, Trash2, X } from "lucide-react";
import { addDays, eachDayOfInterval, format, isValid as isValidDate, startOfDay } from "date-fns";
import { he } from "date-fns/locale";

function parseHHMMOnDate(dateObj, hhmm) {
  if (!dateObj || !hhmm) return null;
  const match = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date(dateObj);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalIsoWithOffset(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const tzMin = -date.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const tzH = pad(Math.floor(Math.abs(tzMin) / 60));
  const tzM = pad(Math.abs(tzMin) % 60);
  return `${y}-${m}-${d}T${hh}:${mm}:00${sign}${tzH}:${tzM}`;
}

function safeFormat(dateLike, pattern) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return isValidDate(date) ? format(date, pattern, { locale: he }) : "";
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function generateHalfHourOptions(open = "08:00", close = "19:00") {
  const [oh, om] = String(open || "08:00").split(":").map(Number);
  const [ch, cm] = String(close || "19:00").split(":").map(Number);
  const options = [];
  const current = new Date();
  current.setHours(oh || 8, om || 0, 0, 0);
  const end = new Date();
  end.setHours(ch || 19, cm || 0, 0, 0);

  while (current < end) {
    options.push(`${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`);
    current.setMinutes(current.getMinutes() + 30);
  }

  const endLabel = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  if (!options.includes(endLabel)) options.push(endLabel);
  return options;
}

function normalizeBlock(block) {
  const start = new Date(block.start_at || block.startAt || block.startsAt);
  const end = new Date(block.end_at || block.endAt || block.endsAt);
  return {
    ...block,
    s: start,
    e: end,
  };
}

function normalizeAppointment(appointment) {
  return {
    ...appointment,
    s: new Date(appointment.starts_at || appointment.startsAt),
    e: new Date(appointment.ends_at || appointment.endsAt),
  };
}

function humanClientName(item) {
  return item.client_name
    || item.client?.firstName
    || item.client_first_name
    || item.client?.first_name
    || "לקוח";
}

function dateToYmd(date) {
  return format(date, "yyyy-MM-dd");
}

const RANGE_FULL_DAY_START = "00:00";
const RANGE_FULL_DAY_END = "23:59";

export default function BlockAppointmentsModal({
  isOpen,
  onClose,
  businessHours = [],
  onBlock,
  appointments = [],
}) {
  const [mode, setMode] = useState("single");
  const [dateStr, setDateStr] = useState(() => dateToYmd(new Date()));
  const [rangeStart, setRangeStart] = useState(() => dateToYmd(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => dateToYmd(addDays(new Date(), 1)));
  const [timeRanges, setTimeRanges] = useState([{ id: 1, from: "", to: "", saved: false }]);
  const [editingBlock, setEditingBlock] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [dayAppointments, setDayAppointments] = useState([]);
  const [rangeAppointmentsMap, setRangeAppointmentsMap] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const { showAlert, showConfirm } = useSystemPopup();
  const singleDayStripRef = useRef(null);

  const updateTimeRange = (id, field, value) => {
    setTimeRanges((current) => current.map((range) => range.id === id ? { ...range, [field]: value } : range));
  };

  const addEmptyDraftRange = () => ({ id: Date.now() + Math.floor(Math.random() * 1000), from: "", to: "", saved: false });

  const removeTimeRange = (id) => {
    setTimeRanges((current) => {
      const next = current.filter((range) => range.id !== id);
      if (next.some((range) => !range.saved)) return next;
      return [...next, addEmptyDraftRange()];
    });
  };

  const dateOptions = useMemo(
    () => Array.from({ length: 60 }, (_, index) => addDays(startOfDay(new Date()), index)),
    []
  );

  const selectedDate = useMemo(() => {
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [dateStr]);

  const selectedRangeStart = useMemo(() => {
    const date = new Date(rangeStart);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [rangeStart]);

  const selectedRangeEnd = useMemo(() => {
    const date = new Date(rangeEnd);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [rangeEnd]);

  const daysInRange = useMemo(() => {
    if (!selectedRangeStart || !selectedRangeEnd || selectedRangeEnd < selectedRangeStart) return [];
    return eachDayOfInterval({ start: startOfDay(selectedRangeStart), end: startOfDay(selectedRangeEnd) });
  }, [selectedRangeEnd, selectedRangeStart]);

  const hoursForDay = useMemo(() => {
    if (!selectedDate) return null;
    const weekday = selectedDate.getDay();
    const hours = (businessHours || []).find((entry) => entry.weekday === weekday) || null;
    if (!hours) return { open: "08:00", close: "19:00", isClosed: false };
    const isClosed = Boolean(hours.is_closed ?? !hours.isOpen);
    return {
      open: hours.open_time ?? hours.open ?? "08:00",
      close: hours.close_time ?? hours.close ?? "19:00",
      isClosed,
    };
  }, [businessHours, selectedDate]);

  const timeOptions = useMemo(
    () => generateHalfHourOptions(hoursForDay?.open || "08:00", hoursForDay?.close || "19:00"),
    [hoursForDay]
  );

  const openLabel = hoursForDay?.isClosed
    ? "היום מסומן כסגור ביומן העסק"
    : `${hoursForDay?.open ?? "--:--"} – ${hoursForDay?.close ?? "--:--"}`;

  useEffect(() => {
    if (!isOpen || timeOptions.length <= 1) return;
    setTimeRanges((current) => current.map((range, index) => {
      if (range.from && range.to) return range;
      return {
        ...range,
        from: range.from || timeOptions[0],
        to: range.to || timeOptions[Math.min(index + 2, timeOptions.length - 1)],
      };
    }));
  }, [isOpen, timeOptions]);

  useEffect(() => {
    if (!isOpen) {
      setMode("single");
      setEditingBlock(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    let stop = false;

    (async () => {
      try {
        if (!selectedDate) {
          setDayAppointments([]);
          return;
        }

        if (Admin?.appointmentsByDate) {
          const list = await Admin.appointmentsByDate(dateStr);
          if (!stop) setDayAppointments(Array.isArray(list) ? list : []);
        } else if (!stop) {
          setDayAppointments(Array.isArray(appointments) ? appointments : []);
        }
      } catch {
        if (!stop) setDayAppointments(Array.isArray(appointments) ? appointments : []);
      }
    })();

    return () => {
      stop = true;
    };
  }, [appointments, dateStr, selectedDate]);

  useEffect(() => {
    let stop = false;

    (async () => {
      try {
        if (!selectedDate) {
          setBlocks([]);
          return;
        }

        const list = await Admin.blocks.list(dateStr);
        const dayStart = startOfDay(selectedDate);
        const dayEnd = addDays(dayStart, 1);
        const normalized = (Array.isArray(list) ? list : [])
          .map(normalizeBlock)
          .filter((block) => isValidDate(block.s) && isValidDate(block.e))
          .filter((block) => block.s < dayEnd && block.e > dayStart)
          .sort((a, b) => a.s - b.s);

        if (!stop) setBlocks(normalized);
      } catch {
        if (!stop) setBlocks([]);
      }
    })();

    return () => {
      stop = true;
    };
  }, [dateStr, selectedDate]);

  useEffect(() => {
    let stop = false;

    (async () => {
      if (!isOpen || mode !== "range" || daysInRange.length === 0) {
        setRangeAppointmentsMap({});
        return;
      }

      try {
        const entries = await Promise.all(
          daysInRange.map(async (day) => {
            const ymd = dateToYmd(day);
            const list = Admin?.appointmentsByDate ? await Admin.appointmentsByDate(ymd) : appointments;
            return [ymd, Array.isArray(list) ? list : []];
          })
        );

        if (!stop) {
          setRangeAppointmentsMap(Object.fromEntries(entries));
        }
      } catch {
        if (!stop) {
          const fallback = Object.fromEntries(daysInRange.map((day) => [dateToYmd(day), Array.isArray(appointments) ? appointments : []]));
          setRangeAppointmentsMap(fallback);
        }
      }
    })();

    return () => {
      stop = true;
    };
  }, [appointments, daysInRange, isOpen, mode]);


  useEffect(() => {
    if (mode !== "single" || !singleDayStripRef.current) return;
    const index = dateOptions.findIndex((day) => dateToYmd(day) === dateStr);
    if (index < 0) return;
    const target = singleDayStripRef.current.querySelector(`[data-day-index="${index}"]`);
    target?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [dateOptions, dateStr, mode]);

  const normalizedDayAppointments = useMemo(
    () => (dayAppointments || [])
      .map(normalizeAppointment)
      .filter((appointment) => isValidDate(appointment.s) && isValidDate(appointment.e))
      .sort((a, b) => a.s - b.s),
    [dayAppointments]
  );

  const activeAppointmentsForDay = useMemo(
    () => normalizedDayAppointments.filter((appointment) => String(appointment.status || "").toLowerCase() !== "canceled"),
    [normalizedDayAppointments]
  );

  const normalizedTimeRanges = useMemo(() => {
    if (mode !== "single" || !selectedDate) return [];
    return timeRanges
      .map((range) => {
        const start = parseHHMMOnDate(selectedDate, range.from);
        const end = parseHHMMOnDate(selectedDate, range.to);
        return {
          ...range,
          start,
          end,
          valid: Boolean(start && end && end > start),
          saved: Boolean(range.saved),
        };
      });
  }, [mode, selectedDate, timeRanges]);

  const committedTimeRanges = useMemo(() => normalizedTimeRanges.filter((range) => range.saved), [normalizedTimeRanges]);
  const draftTimeRange = useMemo(() => normalizedTimeRanges.find((range) => !range.saved) || null, [normalizedTimeRanges]);

  const handleAddTimeRange = async () => {
    if (editingBlock || !draftTimeRange) return;
    if (!draftTimeRange.valid) {
      await showAlert("בחר טווח שעות תקין לפני שמוסיפים.");
      return;
    }
    const duplicate = committedTimeRanges.some((range) => range.start?.getTime() === draftTimeRange.start?.getTime() && range.end?.getTime() === draftTimeRange.end?.getTime());
    if (duplicate) {
      await showAlert("הטווח הזה כבר נוסף למטה.");
      return;
    }
    const overlapsExisting = committedTimeRanges.some((range) => overlaps(range.start, range.end, draftTimeRange.start, draftTimeRange.end));
    if (overlapsExisting) {
      await showAlert("הטווח הזה חופף לטווח שכבר הוספת.");
      return;
    }

    setTimeRanges((current) => current.flatMap((range) => {
      if (range.id !== draftTimeRange.id) return range;
      return [{ ...range, saved: true }, addEmptyDraftRange()];
    }));
  };

  const selectedRangeConflicts = useMemo(() => {
    if (mode !== "single") return [];
    return normalizedTimeRanges
      .filter((range) => range.valid)
      .map((range) => ({
        ...range,
        conflicts: activeAppointmentsForDay.filter((appointment) => overlaps(appointment.s, appointment.e, range.start, range.end)),
      }))
      .filter((range) => range.conflicts.length > 0);
  }, [activeAppointmentsForDay, mode, normalizedTimeRanges]);

  const overlappingSelectedRanges = useMemo(() => {
    const validRanges = normalizedTimeRanges.filter((range) => range.valid);
    const collisions = [];
    for (let i = 0; i < validRanges.length; i += 1) {
      for (let j = i + 1; j < validRanges.length; j += 1) {
        if (overlaps(validRanges[i].start, validRanges[i].end, validRanges[j].start, validRanges[j].end)) {
          collisions.push([validRanges[i].id, validRanges[j].id]);
        }
      }
    }
    return collisions;
  }, [normalizedTimeRanges]);

  const rangeConflicts = useMemo(() => {
    if (mode !== "range") return [];

    return daysInRange.flatMap((day) => {
      const ymd = dateToYmd(day);
      const dayStart = parseHHMMOnDate(day, RANGE_FULL_DAY_START);
      const dayEnd = parseHHMMOnDate(day, RANGE_FULL_DAY_END);
      const appointmentsForDay = (rangeAppointmentsMap[ymd] || [])
        .map(normalizeAppointment)
        .filter((appointment) => isValidDate(appointment.s) && isValidDate(appointment.e))
        .filter((appointment) => String(appointment.status || "").toLowerCase() !== "canceled");

      const conflicts = appointmentsForDay.filter((appointment) => overlaps(appointment.s, appointment.e, dayStart, dayEnd));
      if (conflicts.length === 0) return [];

      return [{ date: ymd, conflicts }];
    });
  }, [daysInRange, mode, rangeAppointmentsMap]);

  const canSubmitSingle = Boolean(selectedDate && !hoursForDay?.isClosed && normalizedTimeRanges.length > 0 && normalizedTimeRanges.every((range) => range.valid) && selectedRangeConflicts.length === 0 && overlappingSelectedRanges.length === 0);
  const canSubmitRange = Boolean(daysInRange.length > 0 && selectedRangeEnd && selectedRangeStart && selectedRangeEnd >= selectedRangeStart && rangeConflicts.length === 0);

  const clearForm = () => {
    setMode("single");
    setEditingBlock(null);
    setDateStr(dateToYmd(new Date()));
    setRangeStart(dateToYmd(new Date()));
    setRangeEnd(dateToYmd(addDays(new Date(), 1)));
    setTimeRanges([{ id: 1, from: timeOptions[0] || "08:00", to: timeOptions[Math.min(2, timeOptions.length - 1)] || "09:00", saved: false }]);
  };

  const setFullDay = () => {
    if (!hoursForDay?.isClosed) {
      setTimeRanges([{ id: 1, from: hoursForDay?.open || "08:00", to: hoursForDay?.close || "19:00", saved: false }]);
    }
  };

  const snapNextHour = (id) => {
    const currentRange = timeRanges.find((range) => range.id === id);
    if (!currentRange?.from) return;
    const [hours, minutes] = currentRange.from.split(":").map(Number);
    const targetMinutes = (hours * 60) + minutes + 60;
    const next = `${String(Math.floor(targetMinutes / 60)).padStart(2, "0")}:${String(targetMinutes % 60).padStart(2, "0")}`;
    updateTimeRange(id, "to", timeOptions.includes(next) ? next : (timeOptions[timeOptions.length - 1] || next));
  };

  const beginEdit = (block) => {
    if (!block?.s || !block?.e) return;
    setMode("single");
    setDateStr(format(block.s, "yyyy-MM-dd"));
    setTimeRanges([{ id: 1, from: format(block.s, "HH:mm"), to: format(block.e, "HH:mm"), saved: false }]);
    setEditingBlock(block);
  };

  const refreshBlocks = async (targetDate = dateStr) => {
    if (!targetDate) return;
    const day = new Date(targetDate);
    const list = await Admin.blocks.list(targetDate);
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const normalized = (Array.isArray(list) ? list : [])
      .map(normalizeBlock)
      .filter((block) => isValidDate(block.s) && isValidDate(block.e))
      .filter((block) => block.s < dayEnd && block.e > dayStart)
      .sort((a, b) => a.s - b.s);
    setBlocks(normalized);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    try {
      setSubmitting(true);

      if (mode === "single") {
        if (!canSubmitSingle) return;

        const validRanges = normalizedTimeRanges.filter((range) => range.valid && (range.saved || range.from || range.to));
        if (validRanges.length === 0) {
          await showAlert("בחר לפחות טווח שעות אחד תקין.");
          return;
        }

        if (editingBlock) {
          const [range] = validRanges;
          await Admin.blocks.update(editingBlock.id, toLocalIsoWithOffset(range.start), toLocalIsoWithOffset(range.end), "", false);
        } else {
          for (const range of validRanges) {
            await Admin.blocks.add(toLocalIsoWithOffset(range.start), toLocalIsoWithOffset(range.end), "", false);
          }
        }
      } else {
        if (!canSubmitRange) return;

        for (const day of daysInRange) {
          const start = parseHHMMOnDate(day, RANGE_FULL_DAY_START);
          const end = parseHHMMOnDate(day, RANGE_FULL_DAY_END);
          await Admin.blocks.add(toLocalIsoWithOffset(start), toLocalIsoWithOffset(end), "", false);
        }
      }

      await onBlock?.();
      clearForm();
      onClose?.();
    } catch (error) {
      console.error("Error blocking time:", error);
      const payload = error?.payload || {};
      const message = payload.error || payload.message || "לא הצלחנו לשמור את החסימה.";
      const details = Array.isArray(payload.conflicts)
        ? `\n${payload.conflicts.map((item) => `${safeFormat(item.starts_at, "dd/MM HH:mm")}-${safeFormat(item.ends_at, "HH:mm")} · ${humanClientName(item)}`).join("\n")}`
        : "";
      await showAlert(`${message}${details}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 mx-3 max-h-[88vh] w-[min(100%-24px,28rem)] overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:mx-4 sm:max-h-[90vh] sm:w-full sm:max-w-3xl sm:rounded-[32px]">
        <div className="relative border-b border-slate-100 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-700 px-4 py-4 text-white sm:px-8 sm:py-6">
          <Button variant="ghost" size="icon" onClick={onClose} className="absolute right-3 top-3 rounded-full text-white hover:bg-white/10 hover:text-white sm:right-5 sm:top-5">
            <X className="h-5 w-5" />
          </Button>
          <div className="flex items-center justify-center">
            <h3 className="text-xl font-black sm:text-2xl">חסימת תורים</h3>
          </div>
        </div>

        <div className="max-h-[calc(88vh-72px)] overflow-y-auto px-4 py-4 sm:max-h-[calc(90vh-88px)] sm:px-8 sm:py-6">
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr] xl:gap-6">
            <div className="space-y-4 sm:space-y-6">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-2 sm:rounded-[28px] sm:p-3">
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  {[
                    { id: "single", label: "יום מסוים", sublabel: "שעות מדויקות ביום אחד", icon: Clock3 },
                    { id: "range", label: "טווח ימים", sublabel: "חסימה מלאה לכמה ימים", icon: CalendarDays },
                  ].map((option) => {
                    const ActiveIcon = option.icon;
                    const active = mode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setMode(option.id);
                          setEditingBlock(null);
                        }}
                        className={`rounded-[20px] border px-3 py-3 text-right transition-all sm:rounded-[24px] sm:px-4 sm:py-4 ${active
                          ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                          : "border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between sm:mb-3">
                          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl sm:h-11 sm:w-11 ${active ? "bg-white/15" : "bg-slate-100"}`}>
                            <ActiveIcon className="h-5 w-5" />
                          </span>
                        </div>
                        <div className="text-sm font-bold sm:text-base">{option.label}</div>
                        <div className={`mt-1 text-xs sm:text-sm ${active ? "text-white/75" : "text-slate-500"}`}>{option.sublabel}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                {mode === "single" ? (
                  <>
                    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:rounded-[28px] sm:p-5">
                      <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div>
                          <h4 className="text-lg font-bold text-slate-900">1. בוחרים יום</h4>
                          <p className="text-sm text-slate-500">בחר את היום שבו רוצים לסגור שעות ספציפיות.</p>
                        </div>
                        <div className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          שעות פעילות: {openLabel}
                        </div>
                      </div>

                      <div className="mx-auto w-full max-w-[312px] overflow-hidden rounded-[22px] border border-slate-100 bg-slate-50 px-2 py-2 sm:max-w-full">
                        <div ref={singleDayStripRef} dir="rtl" className="flex max-w-full overflow-x-auto gap-3 px-1 pb-1 scrollbar-hide snap-x snap-mandatory scroll-smooth">
                          {dateOptions.map((day, index) => {
                            const ymd = dateToYmd(day);
                            const active = ymd === dateStr;
                            return (
                              <div key={ymd} data-day-index={index} className="flex-shrink-0 snap-center">
                                <button
                                  type="button"
                                  onClick={() => setDateStr(ymd)}
                                  className={`flex h-16 w-14 flex-col items-center justify-center rounded-2xl transition-all duration-200 ${
                                    active ? "bg-black text-white shadow-md" : "bg-white text-gray-700 hover:bg-gray-50"
                                  }`}
                                >
                                  <span className="text-xs font-medium">{safeFormat(day, "E")}</span>
                                  <span className="text-lg font-bold">{safeFormat(day, "d")}</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:rounded-[28px] sm:p-5">
                      <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div>
                          <h4 className="text-lg font-bold text-slate-900">2. בוחרים שעות</h4>
                          <p className="text-sm text-slate-500">ללא שעון מסובך — פשוט בוחרים מהרשימה.</p>
                        </div>
                        {editingBlock && (
                          <div className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                            מצב עריכה
                          </div>
                        )}
                      </div>
                      <div className="space-y-3">
                        {draftTimeRange && (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-800">טווח חדש</div>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-500" onClick={() => snapNextHour(draftTimeRange.id)}>
                                <Clock3 className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">משעה</label>
                                <Select value={draftTimeRange.from || ""} onValueChange={(value) => updateTimeRange(draftTimeRange.id, "from", value)} disabled={hoursForDay?.isClosed} dir="rtl">
                                  <SelectTrigger className="h-12 rounded-[18px] border-slate-200 bg-white px-4 text-base sm:h-14 sm:rounded-[20px]">
                                    <SelectValue placeholder="בחר שעה" />
                                  </SelectTrigger>
                                  <SelectContent className="z-[3000]" align="end">
                                    {timeOptions.slice(0, -1).map((time) => (
                                      <SelectItem key={`${draftTimeRange.id}-${time}-from`} value={time}>{time}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">עד שעה</label>
                                <Select value={draftTimeRange.to || ""} onValueChange={(value) => updateTimeRange(draftTimeRange.id, "to", value)} disabled={hoursForDay?.isClosed} dir="rtl">
                                  <SelectTrigger className="h-12 rounded-[18px] border-slate-200 bg-white px-4 text-base sm:h-14 sm:rounded-[20px]">
                                    <SelectValue placeholder="בחר שעה" />
                                  </SelectTrigger>
                                  <SelectContent className="z-[3000]" align="end">
                                    {timeOptions.map((time) => (
                                      <SelectItem key={`${draftTimeRange.id}-${time}-to`} value={time}>{time}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        )}

                        {committedTimeRanges.length > 0 && !editingBlock && (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-3">
                            <div className="mb-2 text-sm font-semibold text-slate-800">טווחים שהוספת</div>
                            <div className="flex flex-wrap gap-2">
                              {committedTimeRanges.map((range, index) => (
                                <div key={range.id} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-xs font-medium text-white">
                                  <span>טווח {index + 1}: {safeFormat(range.start, "HH:mm")}–{safeFormat(range.end, "HH:mm")}</span>
                                  <button type="button" onClick={() => removeTimeRange(range.id)} className="rounded-full bg-white/10 px-1 text-white hover:bg-white/20">×</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {!editingBlock && (
                          <Button type="button" variant="outline" onClick={handleAddTimeRange} disabled={hoursForDay?.isClosed} className="rounded-full border-slate-200 bg-white px-4">
                            <Plus className="ml-1 h-4 w-4" />
                            הוסף טווח שעות
                          </Button>
                        )}
                        <Button type="button" variant="outline" onClick={setFullDay} disabled={hoursForDay?.isClosed} className="rounded-full border-slate-200 bg-white px-4">
                          חסום את כל היום
                        </Button>
                      </div>

                      {hoursForDay?.isClosed && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          היום הזה מוגדר כסגור בשעות הפעילות, לכן כרגע אי אפשר לשמור עבורו חסימת שעות.
                        </div>
                      )}

                      {(selectedRangeConflicts.length > 0 || overlappingSelectedRanges.length > 0) && (
                        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                          {selectedRangeConflicts.length > 0 && (
                            <>
                              <div className="font-bold">אי אפשר לחסום כרגע — יש תורים פעילים באחד או יותר מהטווחים שבחרת.</div>
                              <ul className="mt-2 space-y-1 text-xs sm:text-sm">
                                {selectedRangeConflicts.slice(0, 3).map((entry) => (
                                  <li key={entry.id}>• טווח {normalizedTimeRanges.findIndex((range) => range.id === entry.id) + 1}: {entry.conflicts.slice(0, 2).map((appointment) => `${safeFormat(appointment.s, "HH:mm")}–${safeFormat(appointment.e, "HH:mm")} · ${humanClientName(appointment)}`).join(' | ')}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          {overlappingSelectedRanges.length > 0 && (
                            <div className={`${selectedRangeConflicts.length > 0 ? "mt-3" : ""} text-xs sm:text-sm`}>
                              חלק מטווחי השעות שבחרת חופפים אחד לשני — צריך להפריד ביניהם לפני השמירה.
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  </>
                ) : (
                  <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:rounded-[28px] sm:p-5">
                    <div className="mb-4">
                      <h4 className="text-lg font-bold text-slate-900">בחר טווח ימים מלא</h4>
                      <p className="text-sm text-slate-500">מתאים לחופשה, מילואים, שיפוץ או כל תקופה שבה לא רוצים לקבל תורים בכלל.</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="mb-2 text-sm font-semibold text-slate-700">מיום</div>
                        <div className="w-full overflow-hidden rounded-[22px] border border-slate-100 bg-slate-50 p-2">
                          <div className="max-h-44 overflow-y-auto px-1 py-1 scrollbar-hide">
                            <div className="grid grid-cols-3 gap-2">
                              {dateOptions.map((day) => {
                                const ymd = dateToYmd(day);
                                const active = ymd === rangeStart;
                                return (
                                  <button
                                    key={`start-${ymd}`}
                                    type="button"
                                    onClick={() => {
                                      setRangeStart(ymd);
                                      if (ymd > rangeEnd) setRangeEnd(ymd);
                                    }}
                                    className={`flex h-12 items-center justify-center rounded-full px-2 text-sm transition ${active ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
                                  >
                                    {safeFormat(day, "d/M")}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-sm font-semibold text-slate-700">עד יום</div>
                        <div className="w-full overflow-hidden rounded-[22px] border border-slate-100 bg-slate-50 p-2">
                          <div className="max-h-44 overflow-y-auto px-1 py-1 scrollbar-hide">
                            <div className="grid grid-cols-3 gap-2">
                              {dateOptions.map((day) => {
                                const ymd = dateToYmd(day);
                                const active = ymd === rangeEnd;
                                const disabled = ymd < rangeStart;
                                return (
                                  <button
                                    key={`end-${ymd}`}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => setRangeEnd(ymd)}
                                    className={`flex h-12 items-center justify-center rounded-full px-2 text-sm transition ${active ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-100"} ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                                  >
                                    {safeFormat(day, "d/M")}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-semibold text-slate-900">
                        סיכום חסימה: {daysInRange.length || 0} ימים
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {daysInRange.length > 0
                          ? `${safeFormat(selectedRangeStart, "EEEE d/MM")} ועד ${safeFormat(selectedRangeEnd, "EEEE d/MM")} — חסימה מלאה לכל יום בטווח.`
                          : "בחר טווח תקין כדי להמשיך."}
                      </div>
                    </div>

                    {rangeConflicts.length > 0 && (
                      <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                        <div className="font-bold">אי אפשר לחסום את הטווח הזה עד שמבטלים את התורים שכבר הוזמנו.</div>
                        <div className="mt-2 space-y-2 text-xs sm:text-sm">
                          {rangeConflicts.slice(0, 4).map((entry) => (
                            <div key={entry.date} className="rounded-xl bg-white/60 px-3 py-2">
                              <div className="font-semibold">{safeFormat(entry.date, "EEEE d/MM")}</div>
                              {entry.conflicts.slice(0, 3).map((appointment) => (
                                <div key={appointment.id}>• {safeFormat(appointment.s, "HH:mm")}–{safeFormat(appointment.e, "HH:mm")} · {humanClientName(appointment)}</div>
                              ))}
                              {entry.conflicts.length > 3 && <div>ועוד {entry.conflicts.length - 3} תורים ביום הזה.</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                <div className="grid grid-cols-2 gap-3 xl:hidden">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                    <div className="text-lg font-black text-slate-900">{activeAppointmentsForDay.length}</div>
                    <div className="text-xs text-slate-500">תורים ביום הזה</div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-center">
                    <div className="text-lg font-black text-amber-900">{blocks.length}</div>
                    <div className="text-xs text-amber-700">חסימות קיימות</div>
                  </div>
                </div>

                <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-slate-100 bg-white/95 pt-4 backdrop-blur sm:static sm:flex-row sm:justify-end sm:border-t-0 sm:bg-transparent sm:pt-0">
                  {editingBlock && (
                    <Button type="button" variant="ghost" onClick={clearForm} className="rounded-full text-slate-500 hover:text-slate-900">
                      בטל עריכה
                    </Button>
                  )}
                  <Button type="button" variant="outline" onClick={onClose} className="rounded-full border-slate-200 px-6">
                    ביטול
                  </Button>
                  <Button
                    type="submit"
                    disabled={submitting || (mode === "single" ? !canSubmitSingle : !canSubmitRange)}
                    className="rounded-full bg-slate-950 px-6 text-white hover:bg-slate-800"
                  >
                    {submitting ? "שומר..." : editingBlock ? "עדכן חסימה" : mode === "single" ? "שמור חסימה" : "חסום את כל הטווח"}
                  </Button>
                </div>
              </form>
            </div>

            <div className="hidden space-y-3 sm:space-y-4 xl:block">
              <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:rounded-[28px] sm:p-5">
                <div className="mb-3 flex items-center gap-2 text-slate-900">
                  <Clock3 className="h-4 w-4" />
                  <h4 className="font-bold">תורים שכבר קיימים ביום הנבחר</h4>
                </div>
                <div className="space-y-2">
                  {activeAppointmentsForDay.length === 0 ? (
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">אין תורים פעילים ביום הזה.</div>
                  ) : (
                    activeAppointmentsForDay.map((appointment) => (
                      <div key={appointment.id} className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                        <div className="font-semibold text-slate-900">{safeFormat(appointment.s, "HH:mm")}–{safeFormat(appointment.e, "HH:mm")}</div>
                        <div className="mt-1">{humanClientName(appointment)}</div>
                        {(appointment.phone || appointment.client_phone) && (
                          <div className="mt-1 text-xs text-slate-500">{appointment.phone || appointment.client_phone}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-4 sm:rounded-[28px] sm:p-5">
                <div className="mb-3 flex items-center gap-2 text-amber-900">
                  <Ban className="h-4 w-4" />
                  <h4 className="font-bold">חסימות שכבר הוגדרו ליום הנבחר</h4>
                </div>
                <div className="space-y-2">
                  {blocks.length === 0 ? (
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">אין חסימות ביום הזה.</div>
                  ) : (
                    blocks.map((block) => (
                      <div key={block.id} className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900">{safeFormat(block.s, "HH:mm")}–{safeFormat(block.e, "HH:mm")}</div>
                            <div className="mt-1 text-xs text-slate-500">{safeFormat(block.s, "EEEE d/MM")}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-500 hover:text-slate-900" onClick={() => beginEdit(block)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-full text-rose-500 hover:text-rose-700"
                              onClick={async () => {
                                if (!await showConfirm("לבטל את החסימה הזו?")) return;
                                try {
                                  await Admin.blocks.remove(block.id);
                                  if (editingBlock?.id === block.id) clearForm();
                                  await refreshBlocks(dateStr);
                                } catch (error) {
                                  console.error("Error deleting block:", error);
                                  await showAlert("לא הצלחנו לבטל את החסימה.");
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
