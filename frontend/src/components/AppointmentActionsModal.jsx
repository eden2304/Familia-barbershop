import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scissors, Calendar, Clock, Phone, MessageCircle, Trash2, Repeat, Send, X, ChevronRight } from 'lucide-react';
import { format, addMinutes, addDays, isAfter, isBefore, parse, startOfDay, isSameDay } from 'date-fns';
import { he } from 'date-fns/locale';
import { fullName, phone, serviceName } from '@/lib/apt-utils';
import { Admin as AdminApi } from '@/api/base44Client';

export default function AppointmentActionsModal({
  appointment,
  service,
  isOpen,
  onClose,
  onDelete,
  onReschedule,
  onCreateRecurring,
  allAppointments = [],
  businessHours = [],
}) {
  const [view, setView] = useState('main'); // 'main' | 'delay' | 'recurring'
  const [deleting, setDeleting] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState('10');
  const [creatingRecurring, setCreatingRecurring] = useState(false);
  const [editingField, setEditingField] = useState(null); // 'date' | 'time' | null
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [savingReschedule, setSavingReschedule] = useState(false);
  const [appointmentsForDate, setAppointmentsForDate] = useState(allAppointments);
  const [appointmentsDateKey, setAppointmentsDateKey] = useState(null);

// ממיר למספר בינ״ל ל-wa.me / api.whatsapp.com (ללא פלוס)
  const toWaMsisdn = (raw) => {
    const d = String(raw || '').replace(/\D/g, ''); // ספרות בלבד
    if (!d) return '';
    if (d.startsWith('972')) return d;          // כבר בינ״ל
    if (d.startsWith('0'))  return `972${d.slice(1)}`; // 052... -> 97252...
    if (d.startsWith('5'))  return `972${d}`;   // 52...  -> 97252...
    return `972${d}`;                            // fallback
  };


  if (!appointment) return null;

  const appointmentStart = new Date(appointment.starts_at);
  const now = new Date();
  const isEditable = isAfter(appointmentStart, now);
  const durationMinutes =
    service?.duration_minutes ??
    appointment?.duration_minutes ??
    appointment?.service_duration_minutes ??
    appointment?.duration ??
    30;

  useEffect(() => {
    if (!appointment) return;
    setSelectedDate(startOfDay(appointmentStart));
    setSelectedSlot({
      time: appointmentStart,
      formatted: format(appointmentStart, 'HH:mm'),
    });
    setEditingField(null);
    setSavingReschedule(false);
  }, [appointment]);

  useEffect(() => {
    setAppointmentsForDate(allAppointments);
  }, [allAppointments]);

  useEffect(() => {
    if (!selectedDate || !isOpen) return;
    const dateKey = format(startOfDay(selectedDate), 'yyyy-MM-dd');
    if (dateKey === appointmentsDateKey) return;
    let isActive = true;
    const loadAppointments = async () => {
      try {
        const data = await AdminApi.appointmentsByDate(dateKey).catch(() => []);
        if (!isActive) return;
        setAppointmentsForDate(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!isActive) return;
        setAppointmentsForDate(allAppointments);
      } finally {
        if (isActive) setAppointmentsDateKey(dateKey);
      }
    };
    loadAppointments();
    return () => {
      isActive = false;
    };
  }, [selectedDate, isOpen, appointmentsDateKey, allAppointments]);

  const handleClose = () => {
    setView('main'); // Reset view on close
    setCreatingRecurring(false);
    setEditingField(null);
    onClose();
  };

  const handleCreateRecurring = async (interval) => {
    if (!onCreateRecurring) return;
    try {
      setCreatingRecurring(true);
      await onCreateRecurring(interval);
      setCreatingRecurring(false);
      handleClose();
    } catch (error) {
      setCreatingRecurring(false);
    }
  };

  const handleCall = () => {
    window.location.href = `tel:${phone(appointment)}`;
  };

  const handleSendDelayMessage = () => {
    const originalTime = new Date(appointment.starts_at);
    const delay = parseInt(delayMinutes, 10) || 0;
    const newTime = addMinutes(originalTime, delay);

    const name = fullName(appointment) || '';
    const firstName = (name.trim().split(' ')[0] || '').trim();

    const message =
        `היי ${firstName || ''}, לגבי התור שלך היום בשעה ${format(originalTime, 'HH:mm')}, ` +
        `תגיע בבקשה בעיכוב של ${delay} דקות, כלומר בשעה ${format(newTime, 'HH:mm')}.`;

    const msisdn = toWaMsisdn(phone(appointment) || '');
    if (!msisdn) {
      alert('לא נמצא מספר טלפון תקין לוואטסאפ עבור הלקוח.');
      return;
    }

    const ua = navigator.userAgent || '';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);

    const appUrl = `whatsapp://send?phone=${msisdn}&text=${encodeURIComponent(message)}`;
    const waMeUrl = `https://wa.me/${msisdn}?text=${encodeURIComponent(message)}`;

    if (isMobile) {
      // מובייל: ניווט בטאב הנוכחי → נחשב user gesture, לא נחסם.
      window.location.href = appUrl;
      // אל תסגור את המודל לפני הניווט כדי לא לשבור את ה־gesture.
      return;
    }

    // דסקטופ: לא נוגעים ב־whatsapp:// כדי לא לקבל התראה; פותחים wa.me בלשונית חדשה.
    const a = document.createElement('a');
    a.href = waMeUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // עכשיו אפשר לסגור את המודל
    handleClose();
  };


  const handleDelete = async () => {
    if (!appointment?.id || deleting) return;
    setDeleting(true);
    try {
      // לא מבצע API כאן. רק מעביר ל-parent עם ה-id
        await onDelete?.(appointment.id);
        handleClose(); // נסגור את המודאל גם אם ה-parent לא סגר
      } catch (e) {
      console.error(e);
      // גם במקרה של שגיאה—נסגור. אפשר להוריד את השורה אם מעדיפים להשאיר פתוח.
      handleClose();
    } finally {
      setDeleting(false);
    }
  };

  const normalizeBusinessHourRow = (row) => {
    if (!row) return null;
    const weekday = Number(row.weekday ?? row.day_of_week ?? row.day ?? row.dayOfWeek);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    const open = row.open ?? row.opens_at ?? row.open_time ?? row.start ?? row.start_time;
    const close = row.close ?? row.closes_at ?? row.close_time ?? row.end ?? row.end_time;
    const slotMinutes = Number(
      row.slot ??
      row.slotMinutes ??
      row.slot_minutes ??
      row.slotIntervalMinutes ??
      row.interval ??
      row.interval_minutes ??
      row.intervalMinutes ??
      30
    ) || 30;
    const isOpen = row.isOpen ?? row.is_open ?? Boolean(open && close);
    const isClosed = row.is_closed ?? row.isClosed;
    return { weekday, open, close, slotMinutes, isOpen, isClosed };
  };

  const normalizeTimeValue = (value) => {
    if (!value) return '';
    const text = String(value);
    return text.includes(':') ? text.slice(0, 5) : text;
  };

  const getBusinessHoursForDay = (date) => {
    const dayOfWeek = date.getDay();
    const raw = businessHours.find(h => Number(h.weekday ?? h.day_of_week ?? h.day ?? h.dayOfWeek) === dayOfWeek);
    return normalizeBusinessHourRow(raw);
  };

  const buildSlotsForDate = (date) => {
    if (!date || !durationMinutes) return [];
    const hours = getBusinessHoursForDay(date);
    const isClosed = hours?.isClosed ?? (hours?.isOpen === false);
    if (!hours || isClosed) return [];

    const openValue = normalizeTimeValue(hours.open);
    const closeValue = normalizeTimeValue(hours.close);
    if (!openValue || !closeValue) return [];

    const openTime = parse(openValue, 'HH:mm', date);
    const closeTime = parse(closeValue, 'HH:mm', date);
    const slotInterval = Number(hours.slotMinutes) || 30;
    const slots = [];
    let currentTime = openTime;

    while (isBefore(addMinutes(currentTime, durationMinutes), closeTime)) {
      if (!isSameDay(date, now) || isAfter(currentTime, now)) {
        const slotEnd = addMinutes(currentTime, durationMinutes);
        const hasConflict = appointmentsForDate.some(apt => {
          if (apt.status !== 'booked' || apt.id === appointment.id) return false;
          const aptStart = new Date(apt.starts_at ?? apt.startsAt);
          const aptEnd =
            new Date(
              apt.ends_at ??
              apt.endsAt ??
              addMinutes(aptStart, Number(apt.duration_minutes ?? durationMinutes ?? 30)),
            );
          return isBefore(currentTime, aptEnd) && isAfter(slotEnd, aptStart);
        });

        if (!hasConflict) {
          slots.push({ time: currentTime, formatted: format(currentTime, 'HH:mm') });
        }
      }
      currentTime = addMinutes(currentTime, slotInterval);
    }
    return slots;
  };

  const dateOptions = useMemo(() => {
    if (!appointment) return [];
    return Array.from({ length: 30 }, (_, i) => addDays(startOfDay(new Date()), i));
  }, [appointment]);

  const availableSlots = useMemo(() => {
    if (!selectedDate) return [];
    return buildSlotsForDate(selectedDate);
  }, [selectedDate, service, appointmentsForDate, businessHours]);

  const selectedStart = selectedSlot?.time;
  const hasChanges = selectedStart && selectedStart.getTime() !== appointmentStart.getTime();
  const canSubmit = Boolean(isEditable && hasChanges);

  const handleSelectDate = (date) => {
    setSelectedDate(date);
    const timeCandidate = new Date(date);
    timeCandidate.setHours(appointmentStart.getHours(), appointmentStart.getMinutes(), 0, 0);
    const matchingSlot = buildSlotsForDate(date).find(slot => slot.time.getTime() === timeCandidate.getTime());
    setSelectedSlot(matchingSlot || null);
  };

  const handleRescheduleSubmit = async () => {
    if (!canSubmit || !selectedStart) return;
    try {
      setSavingReschedule(true);
      await onReschedule?.(appointment, service, selectedStart);
      handleClose();
    } catch (error) {
      console.error(error);
    } finally {
      setSavingReschedule(false);
    }
  };

  const renderMainView = () => (
    <>
      <DialogHeader className="text-center mb-4">
        <div className="flex items-center justify-between">
          <div className="w-6"></div>
          <div className="flex-1 text-center">
            <DialogTitle className="text-2xl font-bold text-gray-900">{fullName(appointment)}</DialogTitle>
            <p className="text-sm text-gray-500">
              <a className="underline" href={`tel:${phone(appointment)}`}>{phone(appointment) || '-'}</a>
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="rounded-full"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </DialogHeader>

      <div className="space-y-3 mb-6">
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl">
          <div className="flex items-center gap-3 text-gray-600"><Scissors className="w-4 h-4" /><span>שירות</span></div>
          <span className="font-bold text-gray-800">{service?.name || serviceName(appointment) || 'לא ידוע'}</span>
        </div>
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl">
          <div className="flex items-center gap-3 text-gray-600"><Calendar className="w-4 h-4" /><span>תאריך</span></div>
          <Button
            type="button"
            variant="ghost"
            className={`font-bold text-gray-800 ${!isEditable ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => isEditable && setEditingField(editingField === 'date' ? null : 'date')}
          >
            {format(selectedDate || appointmentStart, 'dd/MM/yyyy', { locale: he })}
          </Button>
        </div>
        {editingField === 'date' && (
          <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm max-h-52 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              {dateOptions.map(date => {
                const dayIsPast = isBefore(date, startOfDay(new Date()));
                return (
                  <Button
                    key={date.toISOString()}
                    variant={isSameDay(date, selectedDate) ? "default" : "outline"}
                    disabled={!isEditable || dayIsPast}
                    onClick={() => handleSelectDate(date)}
                    className="text-xs"
                  >
                    {format(date, 'EEE dd/MM', { locale: he })}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl mt-3">
          <div className="flex items-center gap-3 text-gray-600"><Clock className="w-4 h-4" /><span>שעה</span></div>
          <Button
            type="button"
            variant="ghost"
            className={`font-bold text-gray-800 ${!isEditable ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => isEditable && setEditingField(editingField === 'time' ? null : 'time')}
          >
            {format(selectedStart || appointmentStart, 'HH:mm')}
          </Button>
        </div>
        {editingField === 'time' && (
          <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm max-h-52 overflow-y-auto">
            {availableSlots.length === 0 ? (
              <p className="text-sm text-gray-500 text-center">אין שעות פנויות ביום שנבחר.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {availableSlots.map(slot => (
                  <Button
                    key={slot.formatted}
                    variant={selectedSlot?.formatted === slot.formatted ? "default" : "outline"}
                    onClick={() => setSelectedSlot(slot)}
                    className="text-xs"
                  >
                    {slot.formatted}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        {!isEditable && (
          <p className="text-xs text-gray-500 text-center">לא ניתן לשנות מועד לתורים שכבר עברו.</p>
        )}
        {hasChanges && (
          <Button
            onClick={handleRescheduleSubmit}
            disabled={!canSubmit || savingReschedule}
            className="w-full mt-2 rounded-full"
          >
            אשר שינוי מועד
          </Button>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={handleCall} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl"><Phone className="w-5 h-5"/><span className="text-xs font-medium">התקשר</span></Button>
        <Button onClick={() => setView('delay')} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl"><MessageCircle className="w-5 h-5"/><span className="text-xs font-medium">הודעת עיכוב</span></Button>
        <Button onClick={() => setView('recurring')} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl"><Repeat className="w-5 h-5"/><span className="text-xs font-medium">תור קבוע</span></Button>
      </div>

      <DialogFooter className="mt-6">
        <Button onClick={handleDelete} disabled={deleting} variant="ghost" className="w-full bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 rounded-full py-3">          <Trash2 className="w-4 h-4 ml-2"/>מחק תור</Button>
      </DialogFooter>
    </>
  );

  const renderDelayView = () => (
    <>
      <DialogHeader className="text-center mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setView('main')} className="rounded-full">
            <ChevronRight className="w-5 h-5" />
          </Button>
          <div className="flex-1 text-center">
            <DialogTitle className="text-xl font-bold text-gray-900">שליחת הודעת עיכוב</DialogTitle>
            <p className="text-sm text-gray-600">בחר את מספר דקות העיכוב</p>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-6">
        <Select value={delayMinutes} onValueChange={setDelayMinutes}>
          <SelectTrigger className="h-12 text-base">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 20, 30, 40, 50, 60].map(min => (
              <SelectItem key={min} value={min.toString()}>{min} דקות</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-3">
          <Button onClick={() => setView('main')} variant="outline" className="flex-1 rounded-full py-3">ביטול</Button>
          <Button onClick={handleSendDelayMessage} className="flex-1 bg-black text-white rounded-full py-3"><Send className="w-4 h-4 ml-2"/>שלח הודעה</Button>
        </div>
      </div>
    </>
  );

  const renderRecurringView = () => (
    <>
      <DialogHeader className="text-center mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setView('main')} className="rounded-full">
            <ChevronRight className="w-5 h-5" />
          </Button>
          <div className="flex-1 text-center">
            <DialogTitle className="text-xl font-bold text-gray-900">קביעת תור קבוע</DialogTitle>
            <p className="text-sm text-gray-600">בחר את תדירות החזרה של התור</p>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-4">
        {[
          { label: 'כל שבוע', value: { unit: 'week', interval: 1 } },
          { label: 'כל שבועיים', value: { unit: 'week', interval: 2 } },
          { label: 'כל שלושה שבועות', value: { unit: 'week', interval: 3 } },
          { label: 'כל חודש', value: { unit: 'month', interval: 1 } },
        ].map(({ label, value }) => (
          <Button
            key={label}
            onClick={() => handleCreateRecurring(value)}
            className="w-full rounded-full py-3"
            disabled={creatingRecurring}
          >
            {label}
          </Button>
        ))}
        <Button
          variant="outline"
          className="w-full rounded-full py-3"
          onClick={() => setView('main')}
          disabled={creatingRecurring}
        >
          ביטול
        </Button>
      </div>
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
          className="bg-white rounded-3xl p-6 max-w-sm mx-auto max-h-[90vh] overflow-y-auto"
          aria-describedby={undefined}
      >
        {view === 'main' ? renderMainView() : view === 'delay' ? renderDelayView() : renderRecurringView()}
      </DialogContent>
    </Dialog>
  );
}
