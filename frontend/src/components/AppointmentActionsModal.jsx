import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Scissors, Calendar, Clock, Phone, MessageCircle, Trash2, Replace, Repeat, Send, X, ChevronRight } from 'lucide-react';
import { format, addMinutes } from 'date-fns';
import { he } from 'date-fns/locale';
import { fullName, phone, serviceName } from '@/lib/apt-utils';

export default function AppointmentActionsModal({ appointment, service, isOpen, onClose, onDelete, onRescheduleRequest }) {
  const [view, setView] = useState('main'); // 'main' or 'delay'
  const [deleting, setDeleting] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState('10');

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

  const handleClose = () => {
    setView('main'); // Reset view on close
    onClose();
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
          <span className="font-bold text-gray-800">{format(new Date(appointment.starts_at), 'dd/MM/yyyy', { locale: he })}</span>
        </div>
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl">
          <div className="flex items-center gap-3 text-gray-600"><Clock className="w-4 h-4" /><span>שעה</span></div>
          <span className="font-bold text-gray-800">{format(new Date(appointment.starts_at), 'HH:mm')}</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={handleCall} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl"><Phone className="w-5 h-5"/><span className="text-xs font-medium">התקשר</span></Button>
        <Button onClick={() => setView('delay')} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl"><MessageCircle className="w-5 h-5"/><span className="text-xs font-medium">הודעת עיכוב</span></Button>
        <Button onClick={onRescheduleRequest} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl"><Replace className="w-5 h-5"/><span className="text-xs font-medium">החלף תור</span></Button>
        <Button onClick={() => alert('תכונה זו תהיה זמינה בקרוב')} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl"><Repeat className="w-5 h-5"/><span className="text-xs font-medium">תור קבוע</span></Button>
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
          className="bg-white rounded-3xl p-6 max-w-sm mx-auto"
          aria-describedby={undefined}
      >
        {view === 'main' ? renderMainView() : renderDelayView()}
      </DialogContent>
    </Dialog>
  );
}