import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { format, addDays, startOfWeek, isAfter, isBefore, startOfDay, isSameDay } from "date-fns";
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

  useEffect(() => {
    if (isOpen) {
      setSelectedDay(null);
      setSelectedSlot(null);
      setSelectedWeek(0);
      setAvailableByDate({});
    }
  }, [isOpen]);

  const getWeekDays = (weekOffset = 0) => {
    const start = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const getAppointmentName = (apt) => {
    if (!apt) return "";
    if (apt.client_name) return apt.client_name;
    const first = apt.client?.firstName ?? apt.client_first_name ?? apt.first_name ?? "";
    const last = apt.client?.lastName ?? apt.client_last_name ?? apt.last_name ?? "";
    return `${first} ${last}`.trim();
  };

  const dateKey = (date) => format(date, "yyyy-MM-dd");
  const toTimeOnDate = (date, slot) => {
    if (!date || typeof slot !== "string") return null;
    const [h, m] = slot.split(":");
    const hour = Number(h);
    const minute = Number(m);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    const next = new Date(date);
    next.setHours(hour, minute, 0, 0);
    return Number.isNaN(next.getTime()) ? null : next;
  };

  const fetchAvailableForDate = async (date) => {
    if (!service?.id || !date) return;
    const key = dateKey(date);
    setAvailableByDate((prev) => ({
      ...prev,
      [key]: { slots: prev[key]?.slots ?? [], loading: true, error: null },
    }));
    try {
      const slots = await Appointment.getAvailable(service.id, date, { isMember: true });
      setAvailableByDate((prev) => ({
        ...prev,
        [key]: { slots: Array.isArray(slots) ? slots : [], loading: false, error: null },
      }));
    } catch (error) {
      setAvailableByDate((prev) => ({
        ...prev,
        [key]: { slots: [], loading: false, error: error || new Error("Failed to load") },
      }));
    }
  };

  useEffect(() => {
    if (!isOpen || !service?.id) return;
    const days = getWeekDays(selectedWeek);
    days.forEach((date) => {
      const key = dateKey(date);
      if (!availableByDate[key] || availableByDate[key]?.error) {
        fetchAvailableForDate(date);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedWeek, service?.id]);

  useEffect(() => {
    if (selectedDay) {
      const key = dateKey(selectedDay);
      if (!availableByDate[key]) {
        fetchAvailableForDate(selectedDay);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  const selectedDaySlots = useMemo(() => {
    if (!selectedDay) return [];
    const key = dateKey(selectedDay);
    const raw = availableByDate[key]?.slots ?? [];
    const now = new Date();
    return raw
      .map((slot) => ({ time: toTimeOnDate(selectedDay, slot), formatted: slot }))
      .filter((slot) => slot.time && !Number.isNaN(slot.time.getTime()))
      .filter((slot) => !isSameDay(selectedDay, now) || isAfter(slot.time, now));
  }, [availableByDate, selectedDay]);

  const handleConfirm = () => {
    if (selectedSlot) {
      onSubmit(selectedSlot.time);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onCancel}>
      <DialogContent className="max-w-md w-full bg-white rounded-2xl p-6">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold">החלפת תור עבור {getAppointmentName(appointment) || "לקוח"}</DialogTitle>
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
              {getWeekDays(selectedWeek).map(date => {
                const dayIsPast = isBefore(date, startOfDay(new Date()));
                const dayName = DAYS_IN_WEEK.find(d => d.key === date.getDay())?.name;
                const key = dateKey(date);
                const dayInfo = availableByDate[key];
                const hasSlots = dayInfo ? (dayInfo.slots || []).length > 0 : true;
                const isLoading = dayInfo?.loading;

                return (
                  <Button
                    key={date.toString()}
                    onClick={() => {
                      if (!dayIsPast && !isLoading && hasSlots) {
                        setSelectedDay(date);
                        setSelectedSlot(null);
                      }
                    }}
                    disabled={dayIsPast || isLoading || !hasSlots}
                    variant="outline"
                  >
                    {dayName}, {format(date, 'dd/MM')}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <Button variant="link" onClick={() => setSelectedDay(null)} className="mb-2">חזרה לבחירת תאריך</Button>
            <h3 className="text-gray-600 mb-4">בחר שעה חדשה עבור {format(selectedDay, 'EEEE, dd/MM', { locale: he })}</h3>
            {availableByDate[dateKey(selectedDay)]?.loading && (
              <p className="text-sm text-gray-500 mb-3">טוען שעות פנויות…</p>
            )}
            <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
              {selectedDaySlots.map(slot => (
                <Button 
                  key={slot.formatted} 
                  onClick={() => setSelectedSlot(slot)}
                  variant={selectedSlot?.formatted === slot.formatted ? "default" : "outline"}
                >
                  {slot.formatted}
                </Button>
              ))}
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
