import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Scissors, Calendar, Clock, Phone, Check, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { WaitingList } from '@/api/entities';
import { useSystemPopup } from "@/components/SystemPopupProvider";

const WhatsAppIcon = ({ className = "w-5 h-5" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M20.52 3.48A11.86 11.86 0 0 0 12.07 0C5.5 0 .16 5.34.16 11.91c0 2.1.55 4.15 1.59 5.96L0 24l6.3-1.65a11.9 11.9 0 0 0 5.77 1.47h.01c6.57 0 11.91-5.34 11.91-11.91 0-3.18-1.24-6.17-3.47-8.43Zm-8.45 18.33h-.01a9.9 9.9 0 0 1-5.04-1.38l-.36-.22-3.74.98 1-3.65-.24-.37a9.88 9.88 0 0 1-1.52-5.26c0-5.45 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.9 6.99c0 5.45-4.44 9.9-9.89 9.9Zm5.43-7.42c-.3-.15-1.78-.88-2.06-.98-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.23-.65.08-.3-.15-1.27-.47-2.41-1.49-.89-.8-1.49-1.78-1.66-2.08-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.08-.15-.68-1.65-.94-2.25-.25-.6-.5-.5-.68-.51h-.58c-.2 0-.53.08-.8.38-.28.3-1.05 1.03-1.05 2.5 0 1.48 1.08 2.91 1.23 3.11.15.2 2.12 3.24 5.14 4.54.72.31 1.28.5 1.71.64.72.23 1.37.2 1.89.12.58-.09 1.78-.73 2.03-1.44.25-.7.25-1.3.18-1.43-.08-.13-.28-.2-.58-.35Z" />
  </svg>
);

const toWhatsAppNumber = (raw = "") => {
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `972${digits}`;
  return digits;
};

export default function WaitingListActionModal({ isOpen, onClose, entry, service, onBooked, onRemoved }) {
  const { showAlert } = useSystemPopup();

  if (!entry) return null;

  const desiredDate = entry.desired_date ?? entry.desiredDate;
  const desiredTime = entry.desired_time ?? entry.desiredTime;
  const desiredStartsAt = entry.desired_starts_at ?? entry.desiredStartsAt;
  const desiredDateTime = desiredStartsAt ? new Date(desiredStartsAt) : (desiredDate && desiredTime ? new Date(`${desiredDate}T${desiredTime}:00`) : null);

  const handleClose = () => {
    onClose();
  };

  const handleCall = () => {
    window.location.href = `tel:${entry.phone}`;
  };

  const handleWhatsApp = async () => {
    const number = toWhatsAppNumber(entry.phone);
    if (!number) {
      await showAlert("אין מספר טלפון תקין ללקוח הזה");
      return;
    }
    const firstName = String(entry.client_name || "").trim().split(/\s+/)[0] || "";
    const greeting = firstName ? `היי ${firstName},` : "היי,";
    const serviceLabel = service?.name ? ` ל${service.name}` : "";
    const text = `${greeting} כאן פמיליה לגבי רשימת ההמתנה${serviceLabel}.`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const handleBookOriginalTime = async () => {
    try {
      await WaitingList.assign(entry.id);
      onBooked();
      handleClose();
    } catch (error) {
      console.error("Error booking appointment:", error);
      const message = error?.payload?.message || error?.message || "שגיאה בקביעת התור";
      await showAlert(message);
    }
  };

  const handleRemove = async () => {
    try {
      await WaitingList.remove(entry.id);
      onRemoved?.();
      handleClose();
    } catch (error) {
      console.error("Error removing waiting list entry:", error);
      const message = error?.payload?.message || error?.message || "שגיאה במחיקה";
      await showAlert(message);
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
          <span className="font-bold text-gray-800">{desiredDateTime ? format(desiredDateTime, 'dd/MM/yyyy', { locale: he }) : '-'}</span>
        </div>
        <div className="flex items-center justify-between text-sm bg-gray-50 p-3 rounded-xl">
          <div className="flex items-center gap-3 text-gray-600"><Clock className="w-4 h-4" /><span>שעה מועדפת</span></div>
          <span className="font-bold text-gray-800">{desiredDateTime ? format(desiredDateTime, 'HH:mm') : (desiredTime || '-')}</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={handleCall} variant="outline" className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl">
          <Phone className="w-5 h-5"/>
          <span className="text-xs font-medium">התקשר</span>
        </Button>
        <Button onClick={handleWhatsApp} className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl bg-[#25D366] hover:bg-[#1FB855] text-white">
          <WhatsAppIcon className="w-5 h-5"/>
          <span className="text-xs font-medium">שלח הודעה בוואטסאפ</span>
        </Button>
      </div>

      <Button onClick={handleBookOriginalTime} className="w-full h-auto py-3 flex items-center justify-center gap-2 rounded-2xl bg-green-600 hover:bg-green-700 text-white">
        <Check className="w-5 h-5"/>
        <span className="text-sm font-medium">קבע בזמן המבוקש</span>
      </Button>

      <Button onClick={handleRemove} variant="destructive" className="w-full rounded-2xl">
        <Trash2 className="w-4 h-4 ml-2" />
        הסר מרשימת המתנה
      </Button>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-white rounded-3xl p-6 max-w-md mx-auto">
        {renderMainView()}
      </DialogContent>
    </Dialog>
  );
}
