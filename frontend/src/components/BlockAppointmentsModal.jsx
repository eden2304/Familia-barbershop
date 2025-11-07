// src/components/BlockAppointmentsModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Ban, Clock } from "lucide-react";
import { format, isValid as isValidDate, startOfDay } from "date-fns";
import { he } from "date-fns/locale";
import { Admin } from "@/api/entities";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ---------- helpers ----------
function parseHHMMOnDate(dateObj, hhmm) {
  if (!dateObj || !hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  const d = new Date(dateObj);
  d.setHours(h, min, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
function safeFormat(d, pat) {
  const dd = d instanceof Date ? d : new Date(d);
  return isValidDate(dd) ? format(dd, pat, { locale: he }) : "";
}
// יצירת אופציות חצי שעה
function generateHalfHourOptions(open = "08:00", close = "19:00") {
  const [oh, om] = (open || "08:00").split(":").map(Number);
  const [ch, cm] = (close || "19:00").split(":").map(Number);
  const opts = [];

  const base = new Date();
  base.setHours(oh || 8, om || 0, 0, 0);
  const end = new Date();
  end.setHours(ch || 19, cm || 0, 0, 0);

  const stepMin = 30;
  for (let t = new Date(base); t < end; t = new Date(t.getTime() + stepMin * 60000)) {
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    opts.push(`${hh}:${mm}`);
  }
  const endLabel = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  if (!opts.includes(endLabel)) opts.push(endLabel);
  return opts;
}
function pad2(n) { return String(n).padStart(2, "0"); }
function toLocalIsoWithOffset(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear(), m = pad(d.getMonth()+1), day = pad(d.getDate());
  const hh = pad(d.getHours()), mm = pad(d.getMinutes()), ss = '00';
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzMin) / 60));
  const tzM = pad(Math.abs(tzMin) % 60);
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}${sign}${tzH}:${tzM}`;
}
const overlaps = (aStart, aEnd, bStart, bEnd) => (aStart < bEnd && aEnd > bStart);

export default function BlockAppointmentsModal({
                                                 isOpen,
                                                 onClose,
                                                 businessHours = [],
                                                 onBlock,
                                                 appointments = [],
                                               }) {

  // ברירת מחדל לתאריך היום (yyyy-MM-dd)
  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  });
  const [from, setFrom] = useState(""); // "HH:mm"
  const [to, setTo] = useState("");     // "HH:mm"
  const [reason, setReason] = useState("");

  // חסימות קיימות ליום הנבחר (נטען מהשרת)
  const [blocks, setBlocks] = useState([]);

  const dayDate = useMemo(() => {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [dateStr]);

  // שעות פתיחה לאותו יום
  const hoursForDay = useMemo(() => {
    if (!dayDate) return null;
    const dow = dayDate.getDay();
    const h = (businessHours || []).find(x => x.weekday === dow) || null;
    if (!h) return null;
    const isClosed = (h.is_closed ?? !h.isOpen) || false;
    const open = h.open_time ?? h.open ?? "08:00";
    const close = h.close_time ?? h.close ?? "19:00";
    return { open, close, isClosed };
  }, [dayDate, businessHours]);

  const timeOptions = useMemo(() => {
    const open = hoursForDay?.open || "08:00";
    const close = hoursForDay?.close || "19:00";
    return generateHalfHourOptions(open, close);
  }, [hoursForDay]);

  const disabled = !dayDate || !from || !to || (hoursForDay && hoursForDay.isClosed);

  const setFullDay = () => {
    if (!hoursForDay?.isClosed) {
      setFrom(hoursForDay.open);
      setTo(hoursForDay.close);
    }
  };

  const snapNextHour = () => {
    if (!from) return;
    const [fh, fm] = from.split(":").map(Number);
    const endMin = fh * 60 + fm + 60;
    const hh = String(Math.floor(endMin / 60)).padStart(2, "0");
    const mm = String(endMin % 60).padStart(2, "0");
    const next = `${hh}:${mm}`;
    if (timeOptions.includes(next)) setTo(next);
    else setTo(timeOptions[timeOptions.length - 1]);
  };

  // רשימת תורים קיימים באותו יום (לצורכי תצוגה ואזהרה)
  const conflicts = useMemo(() => {
    if (!dayDate) return [];
    const sDay = startOfDay(dayDate);
    const eDay = new Date(sDay); eDay.setDate(eDay.getDate() + 1);
    return (appointments || [])
        .map(a => ({ ...a, s: new Date(a.starts_at), e: new Date(a.ends_at) }))
        .filter(a => isValidDate(a.s) && isValidDate(a.e))
        .filter(a => a.s < eDay && a.e > sDay)
        .sort((a,b) => a.s - b.s);
  }, [appointments, dayDate]);

  // טעינת חסימות קיימות ליום (השרת תומך ?date=; אם לא, נסנן בצד לקוח)
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        if (!dayDate) { setBlocks([]); return; }
        const list = await Admin.blocks.list(dateStr);
        let arr = Array.isArray(list) ? list : [];
        // סינון ליום הלוקאלי אם השרת החזיר את הכול
        const sDay = startOfDay(dayDate);
        const eDay = new Date(sDay); eDay.setDate(eDay.getDate() + 1);
        arr = arr
            .map(b => ({ ...b, s: new Date(b.start_at || b.startAt), e: new Date(b.end_at || b.endAt) }))
            .filter(b => isValidDate(b.s) && isValidDate(b.e))
            .filter(b => b.s < eDay && b.e > sDay)
            .sort((a,b) => a.s - b.s);
        if (!stop) setBlocks(arr);
      } catch {
        if (!stop) setBlocks([]);
      }
    })();
    return () => { stop = true; };
  }, [dateStr, dayDate]);

  // אזהרת חפיפה לטווח שנבחר כרגע מול תורים
  const selectedRangeConflicts = useMemo(() => {
    if (!dayDate || !from || !to) return [];
    const s = parseHHMMOnDate(dayDate, from);
    const e = parseHHMMOnDate(dayDate, to);
    if (!s || !e || e <= s) return [];
    const appts = (appointments || [])
        .filter(a => (String(a.status || '').toLowerCase() !== 'canceled'))
        .map(a => ({ ...a, s: new Date(a.starts_at), e: new Date(a.ends_at) }))
        .filter(a => isValidDate(a.s) && isValidDate(a.e));
    return appts.filter(a => overlaps(a.s, a.e, s, e));
  }, [appointments, dayDate, from, to]);

  const openLabel = hoursForDay?.isClosed ? "סגור" : `${hoursForDay?.open ?? "--:--"} – ${hoursForDay?.close ?? "--:--"}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (disabled) return;

    const startAt = parseHHMMOnDate(dayDate, from);
    const endAt   = parseHHMMOnDate(dayDate, to);

    if (!startAt || !endAt || isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt <= startAt) {
      alert("טווח שעות לא תקין");
      return;
    }

    // מניעת חסימה אם יש תורים חופפים
    if (selectedRangeConflicts.length > 0) {
      const lines = selectedRangeConflicts
          .slice(0, 6)
          .map(a => `${safeFormat(a.s,"HH:mm")}-${safeFormat(a.e,"HH:mm")} · ${a.client_name || a.client?.firstName || ""}`);
      const more = selectedRangeConflicts.length > 6 ? `ועוד ${selectedRangeConflicts.length - 6}...` : '';
      alert("לא ניתן לחסום: קיימים תורים בטווח שנבחר:\n" + lines.join("\n") + (more ? "\n" + more : ""));
      return;
    }

    try {
      await Admin.blocks.add(
          toLocalIsoWithOffset(startAt),
          toLocalIsoWithOffset(endAt),
          reason || ""
      );
      onBlock?.();
      onClose?.();
    } catch (err) {
      console.error("Error blocking time:", err);
      const msg = (err && err.payload && (err.payload.error || err.payload.message)) || "שגיאה בחסימת תורים.";
      const det = (err && err.payload && err.payload.conflicts && Array.isArray(err.payload.conflicts))
          ? "\n" + err.payload.conflicts.map(c => `${safeFormat(c.starts_at,"HH:mm")}-${safeFormat(c.ends_at,"HH:mm")} · ${c.client_name||''}`).join("\n")
          : "";
      alert(msg + det);
    }
  };

  if (!isOpen) return null;

  return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Ban className="w-5 h-5" />
              <h3 className="text-xl font-bold text-gray-900">חסימת תורים</h3>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Opening hours pill */}
          <div className="mb-4">
          <span className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border bg-gray-50 text-gray-700">
            <Clock className="w-3.5 h-3.5" />
            שעות היום: {openLabel}
          </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
            <div>
              <label className="block text-sm font-medium mb-1">תאריך</label>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">משעה</label>
                <Select
                    value={from || ""}
                    onValueChange={(v) => setFrom(v)}
                    disabled={hoursForDay?.isClosed}
                    dir="rtl"
                >
                  <SelectTrigger className="h-12 rounded-2xl px-4 text-right text-base bg-white border border-gray-300">
                    <SelectValue placeholder="בחר" />
                  </SelectTrigger>
                  <SelectContent className="z-[3000]" align="end">
                    {timeOptions.slice(0, -1).map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">עד שעה</label>
                <Select
                    value={to || ""}
                    onValueChange={(v) => setTo(v)}
                    disabled={hoursForDay?.isClosed}
                    dir="rtl"
                >
                  <SelectTrigger className="h-12 rounded-2xl px-4 text-right text-base bg-white border border-gray-300">
                    <SelectValue placeholder="בחר" />
                  </SelectTrigger>
                  <SelectContent className="z-[3000]" align="end">
                    {timeOptions.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex gap-2">
              <Button
                  type="button"
                  variant="outline"
                  onClick={setFullDay}
                  disabled={hoursForDay?.isClosed}
                  className="rounded-full px-4"
              >
                כל היום
              </Button>
              <Button
                  type="button"
                  variant="outline"
                  onClick={snapNextHour}
                  disabled={!from || hoursForDay?.isClosed}
                  className="rounded-full px-4"
              >
                + שעה
              </Button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">סיבה (אופציונלי)</label>
              <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="למשל: הפסקה, ניקיון, ישיבה..."
              />
            </div>

            {hoursForDay?.isClosed && (
                <div className="text-red-600 text-sm">היום הזה מוגדר כסגור ביומן.</div>
            )}

            {from && to && selectedRangeConflicts.length > 0 && (
                <div className="text-xs text-red-600">
                  לא ניתן לחסום – נמצאו {selectedRangeConflicts.length} תור/ים חופפים לטווח שנבחר.
                </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-full">
                ביטול
              </Button>
              <Button type="submit" disabled={disabled || selectedRangeConflicts.length > 0} className="flex-1 bg-black text-white rounded-full">
                חסום
              </Button>
            </div>
          </form>

          {/* Existing appointments list */}
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <h4 className="text-sm font-semibold text-gray-800">תורים קיימים ביום זה</h4>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {conflicts.length === 0 ? (
                  <div className="text-xs text-gray-500">אין תורים רשומים ליום זה.</div>
              ) : (
                  conflicts.map(a => (
                      <div key={a.id} className="text-xs text-gray-700 bg-gray-50 rounded-xl px-3 py-2">
                        {safeFormat(a.s, "HH:mm")}–{safeFormat(a.e, "HH:mm")} · {a.client_name || a.client?.firstName || a.client_first_name || "לקוח"} ({a.phone || a.client_phone || ""})
                      </div>
                  ))
              )}
            </div>
          </div>

          {/* Existing blocks list */}
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-2">
              <Ban className="w-4 h-4 text-gray-500" />
              <h4 className="text-sm font-semibold text-gray-800">חסימות קיימות ביום זה</h4>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-2">
              {blocks.length === 0 ? (
                  <div className="text-xs text-gray-500">אין חסימות ליום זה.</div>
              ) : (
                  blocks.map(b => (
                      <div key={b.id} className="text-xs text-gray-700 bg-orange-50 rounded-xl px-3 py-2">
                        {safeFormat(b.s, "HH:mm")}–{safeFormat(b.e, "HH:mm")} · {b.reason || "חסימה"}
                      </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
  );
}
