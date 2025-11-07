import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon, Check } from "lucide-react";
import { format, addDays, startOfWeek, parse, isSameDay, addMinutes, isAfter, isBefore, startOfDay } from "date-fns";
import { he } from "date-fns/locale";

const DAYS_IN_WEEK = [
  { key: 0, name: "ראשון" }, { key: 1, name: "שני" }, { key: 2, name: "שלישי" }, 
  { key: 3, name: "רביעי" }, { key: 4, name: "חמישי" }, { key: 5, name: "שישי" }, { key: 6, name: "שבת" }
];

export default function RescheduleModal({ isOpen, onCancel, onSubmit, appointment, service, allAppointments, businessHours }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(0);

  const getWeekDays = (weekOffset = 0) => {
    const start = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const generateTimeSlotsForDay = (date) => {
    if (!service || !date) return [];

    const slots = [];
    const dayOfWeek = date.getDay();
    const hours = businessHours.find(h => h.weekday === dayOfWeek);
    if (!hours || hours.is_closed) return [];

    const openTime = parse(hours.open_time, 'HH:mm', date);
    const closeTime = parse(hours.close_time, 'HH:mm', date);
    let currentTime = openTime;

    while (isBefore(addMinutes(currentTime, service.duration_minutes), closeTime)) {
      if (isAfter(currentTime, new Date())) {
        const slotEnd = addMinutes(currentTime, service.duration_minutes);
        const hasConflict = allAppointments.some(apt => {
          if (apt.status !== 'booked' || apt.id === appointment.id) return false;
          const aptStart = new Date(apt.starts_at);
          const aptEnd = new Date(apt.ends_at);
          return (isBefore(currentTime, aptEnd) && isAfter(slotEnd, aptStart));
        });

        if (!hasConflict) {
          slots.push({ time: currentTime, formatted: format(currentTime, 'HH:mm') });
        }
      }
      currentTime = addMinutes(currentTime, 30);
    }
    return slots;
  };

  const handleConfirm = () => {
    if (selectedSlot) {
      onSubmit(selectedSlot.time);
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
              {getWeekDays(selectedWeek).map(date => {
                const dayIsPast = isBefore(date, startOfDay(new Date()));
                const dayName = DAYS_IN_WEEK.find(d => d.key === date.getDay())?.name;
                const hasSlots = generateTimeSlotsForDay(date).length > 0;

                return (
                  <Button
                    key={date.toString()}
                    onClick={() => !dayIsPast && hasSlots && setSelectedDay(date)}
                    disabled={dayIsPast || !hasSlots}
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
            <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
              {generateTimeSlotsForDay(selectedDay).map(slot => (
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