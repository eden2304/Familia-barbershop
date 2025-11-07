import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Scissors, Calendar, Clock, Phone, MessageCircle, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, startOfWeek, parse, isSameDay, addMinutes, isAfter, isBefore, startOfDay } from 'date-fns';
import { he } from 'date-fns/locale';
import { Appointment } from '@/api/entities';
import { WaitingList } from '@/api/entities';

const DAYS_IN_WEEK = [
  { key: 0, name: "ראשון" }, { key: 1, name: "שני" }, { key: 2, name: "שלישי" }, 
  { key: 3, name: "רביעי" }, { key: 4, name: "חמישי" }, { key: 5, name: "שישי" }, { key: 6, name: "שבת" }
];

export default function WaitingListActionModal({ isOpen, onClose, entry, service, appointments, onBooked }) {
  const [view, setView] = useState('main'); // 'main' or 'reschedule'
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState(null);

  if (!entry) return null;

  const handleClose = () => {
    setView('main');
    setSelectedSlot(null);
    onClose();
  };

  const handleCall = () => {
    window.location.href = `tel:${entry.phone}`;
  };

  const getWeekDays = (weekOffset = 0) => {
    const start = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const generateTimeSlotsForDay = (date) => {
    if (!service || !date) return [];

    const slots = [];
    const dayOfWeek = date.getDay();
    
    // Simple business hours - you might want to get this from businessHours prop
    const openTime = parse('09:00', 'HH:mm', date);
    const closeTime = parse('18:00', 'HH:mm', date);
    let currentTime = openTime;

    while (isBefore(addMinutes(currentTime, service.duration_minutes || 30), closeTime)) {
      if (isAfter(currentTime, new Date())) {
        const slotEnd = addMinutes(currentTime, service.duration_minutes || 30);
        const hasConflict = appointments.some(apt => {
          if (apt.status !== 'booked') return false;
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

  function splitName(n='') {
    const parts = String(n).trim().split(/\s+/);
    return [parts[0] || '', parts.slice(1).join(' ') || ''];
  }

  const handleBookOriginalTime = async () => {
    try {
      const [fn, ln] = splitName(entry.client_name);

      await Appointment.create({
        service_id: entry.service_id,
        starts_at: entry.desired_starts_at,
        ends_at: addMinutes(new Date(entry.desired_starts_at), service?.duration_minutes || 30).toISOString(),
        status: 'booked',
        client_first_name: fn,
        client_last_name: ln,
        client_phone: entry.phone,
      });
      await WaitingList.update(entry.id, { status: 'booked' });
      
      onBooked();
      handleClose();
    } catch (error) {
      console.error("Error booking appointment:", error);
      alert("שגיאה בקביעת התור");
    }
  };

  const handleBookNewTime = async () => {
    if (!selectedSlot) return;

    try {
      const [fn, ln] = splitName(entry.client_name);

      await Appointment.create({
        service_id: entry.service_id,
        starts_at: selectedSlot.time.toISOString(),
        ends_at: addMinutes(selectedSlot.time, service?.duration_minutes || 30).toISOString(),
        status: 'booked',
        client_first_name: fn,
        client_last_name: ln,
        client_phone: entry.phone,
      });
      await WaitingList.update(entry.id, { status: 'booked' });


      onBooked();
      handleClose();
    } catch (error) {
      console.error("Error booking appointment:", error);
      alert("שגיאה בקביעת התור");
    }
  };

  const renderMainView = () => (
    <div className="space-y-6">
      <DialogHeader className="text-center">
        <DialogTitle className="text-2xl font-bold text-gray-900">{entry.client_name}</DialogTitle>
        <p className="text-sm text-gray-500">{entry.phone}</p>
      </DialogHeader>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl">
          <div className="flex items-center gap-3 text-gray-600"><Scissors className="w-4 h-4" /><span>שירות</span></div>
          <span className="font-bold text-gray-800">{service?.name || 'לא ידוע'}</span>
        </div>
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl">
          <div className="flex items-center gap-3 text-gray-600"><Calendar className="w-4 h-4" /><span>תאריך מועדף</span></div>
          <span className="font-bold text-gray-800">{format(new Date(entry.desired_starts_at), 'dd/MM/yyyy', { locale: he })}</span>
        </div>
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl">
          <div className="flex items-center gap-3 text-gray-600"><Clock className="w-4 h-4" /><span>שעה מועדפת</span></div>
          <span className="font-bold text-gray-800">{format(new Date(entry.desired_starts_at), 'HH:mm')}</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={handleCall} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl">
          <Phone className="w-5 h-5"/>
          <span className="text-xs font-medium">התקשר</span>
        </Button>
        <Button onClick={handleBookOriginalTime} className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl bg-green-600 hover:bg-green-700 text-white">
          <Check className="w-5 h-5"/>
          <span className="text-xs font-medium">קבע בזמן המבוקש</span>
        </Button>
      </div>

      <Button onClick={() => setView('reschedule')} variant="outline" className="w-full rounded-full py-3">
        קבע בזמן אחר
      </Button>
    </div>
  );

  const renderRescheduleView = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setView('main')} className="rounded-full">
          <ChevronRight className="w-5 h-5" />
        </Button>
        <div className="text-center flex-1">
          <DialogTitle className="text-xl font-bold">בחר זמן חדש עבור {entry.client_name}</DialogTitle>
        </div>
      </div>
      
      <div className="flex justify-between items-center">
        <Button variant="ghost" size="sm" onClick={() => setSelectedWeek(p => p - 1)} disabled={selectedWeek === 0}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium">{selectedWeek === 0 ? "השבוע" : `שבוע +${selectedWeek}`}</span>
        <Button variant="ghost" size="sm" onClick={() => setSelectedWeek(p => p + 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
        {getWeekDays(selectedWeek).map(date => {
          const dayIsPast = isBefore(date, startOfDay(new Date()));
          const dayName = DAYS_IN_WEEK.find(d => d.key === date.getDay())?.name;
          const hasSlots = generateTimeSlotsForDay(date).length > 0;

          return (
            <div key={date.toString()}>
              <Button
                onClick={() => {/* Show slots for this day */}}
                disabled={dayIsPast || !hasSlots}
                variant="outline"
                className="w-full text-xs"
              >
                {dayName}, {format(date, 'dd/MM')}
              </Button>
              {hasSlots && (
                <div className="mt-2 space-y-1">
                  {generateTimeSlotsForDay(date).slice(0, 3).map(slot => (
                    <Button 
                      key={slot.formatted} 
                      onClick={() => setSelectedSlot(slot)}
                      variant={selectedSlot?.formatted === slot.formatted ? "default" : "outline"}
                      size="sm"
                      className="w-full text-xs"
                    >
                      {slot.formatted}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button onClick={handleBookNewTime} disabled={!selectedSlot} className="w-full bg-black text-white rounded-full py-3">
        <Check className="w-4 h-4 ml-2"/>
        אשר קביעה
      </Button>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-white rounded-3xl p-6 max-w-md mx-auto">
        {view === 'main' ? renderMainView() : renderRescheduleView()}
      </DialogContent>
    </Dialog>
  );
}