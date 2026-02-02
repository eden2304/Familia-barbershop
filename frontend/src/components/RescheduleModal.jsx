import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { format, addDays, startOfWeek, parse, isSameDay, isAfter, isBefore, startOfDay, isValid } from "date-fns";
import { he } from "date-fns/locale";
import { Appointment } from "@/api/entities";

const DAYS_IN_WEEK = [
  { key: 0, name: "ראשון" }, { key: 1, name: "שני" }, { key: 2, name: "שלישי" }, 
  { key: 3, name: "רביעי" }, { key: 4, name: "חמישי" }, { key: 5, name: "שישי" }, { key: 6, name: "שבת" }
];

export default function RescheduleModal({ isOpen, onCancel, onSubmit, appointment, service }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [availableByDate, setAvailableByDate] = useState({});
  const [loadingWeek, setLoadingWeek] = useState(false);

  const getWeekDays = (weekOffset = 0) => {
    const start = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const toYmd = (date) => format(date, "yyyy-MM-dd");

  const normalizeSlotList = (raw) => {
    if (!Array.isArray(raw)) return [];
    const slots = raw
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          return (
            entry.hhmm ||
            entry.time ||
            entry.slot ||
            entry.startsAt ||
            entry.start ||
            entry.formatted ||
            null
          );
        }
        return null;
      })
      .filter((value) => typeof value === "string" && value.includes(":"));
    return Array.from(new Set(slots)).sort();
  };

  const slotsForDay = (date) => {
    if (!date) return [];
    const key = toYmd(date);
    const rawSlots = normalizeSlotList(availableByDate[key]);
    const now = new Date();
    return rawSlots
      .map((hhmm) => ({
        time: parse(hhmm, "HH:mm", date),
        formatted: hhmm,
      }))
      .filter((slot) => isValid(slot.time))
      .filter((slot) => {
        if (!isSameDay(date, now)) return true;
        return isAfter(slot.time, now);
      });
  };

  const weekDays = useMemo(() => getWeekDays(selectedWeek), [selectedWeek]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedDay(null);
    setSelectedSlot(null);
  }, [isOpen, selectedWeek, appointment?.id, service?.id]);

  useEffect(() => {
    if (!isOpen || !service?.id) return;
    let cancelled = false;
    setLoadingWeek(true);

    Promise.all(
      weekDays.map(async (date) => {
        const key = toYmd(date);
        try {
          const raw = await Appointment.getAvailable(service.id, key);
          return [key, normalizeSlotList(raw)];
        } catch (error) {
          console.warn("availability failed for", key, error);
          return [key, []];
        }
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setAvailableByDate((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      })
      .finally(() => {
        if (!cancelled) setLoadingWeek(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, service?.id, weekDays]);

  const handleConfirm = () => {
    if (selectedSlot && isValid(selectedSlot.time)) {
      onSubmit(selectedSlot.time);
    } else {
      console.error("Invalid selected slot time", selectedSlot);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onCancel}>
      <DialogContent className="max-w-md w-full bg-white rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold">החלפת תור עבור {appointment.client_name}</DialogTitle>
        </DialogHeader>
        
        {!selectedDay ? (
          <div className="text-center">
            <h3 className="text-gray-600 mb-4">בחר תאריך חדש</h3>
            <div className="flex justify-between items-center mb-4">
              <Button variant="ghost" size="sm" onClick={() => setSelectedWeek(p => p - 1)} disabled={selectedWeek === 0}><ChevronRight/></Button>
              <span>{selectedWeek === 0 ? "השבוע" : `שבוע +${selectedWeek}`}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedWeek(p => p + 1)}><ChevronLeft/></Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {weekDays.map(date => {
                const dayIsPast = isBefore(date, startOfDay(new Date()));
                const dayName = DAYS_IN_WEEK.find(d => d.key === date.getDay())?.name;
                const hasSlots = slotsForDay(date).length > 0;

                return (
                  <Button
                    key={date.toString()}
                    onClick={() => !dayIsPast && hasSlots && setSelectedDay(date)}
                    disabled={dayIsPast || !hasSlots || loadingWeek}
                    variant="outline"
                  >
                    {dayName}, {format(date, 'dd/MM')}
                  </Button>
                );
              })}
            </div>
            {loadingWeek && (
              <p className="text-xs text-gray-500 mt-3">טוען זמינות…</p>
            )}
          </div>
        ) : (
          <div className="text-center">
            <Button variant="link" onClick={() => setSelectedDay(null)} className="mb-2">חזרה לבחירת תאריך</Button>
            <h3 className="text-gray-600 mb-4">בחר שעה חדשה עבור {format(selectedDay, 'EEEE, dd/MM', { locale: he })}</h3>
            <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
              {slotsForDay(selectedDay).length === 0 ? (
                <p className="text-sm text-gray-500 col-span-3">אין שעות פנויות ביום זה.</p>
              ) : (
                slotsForDay(selectedDay).map(slot => (
                  <Button 
                    key={slot.formatted} 
                    onClick={() => setSelectedSlot(slot)}
                    variant={selectedSlot?.formatted === slot.formatted ? "default" : "outline"}
                  >
                    {slot.formatted}
                  </Button>
                ))
              )}
            </div>
          </div>
        )}

        <DialogFooter className="mt-6">
          <Button onClick={handleConfirm} disabled={!selectedSlot} className="w-full bg-black text-white rounded-full">
            <Check className="w-4 h-4 ml-2"/>אשר החלפה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
