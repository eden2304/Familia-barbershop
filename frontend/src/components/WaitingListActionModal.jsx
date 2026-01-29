import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Scissors, Calendar, Clock, Phone, Check, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { WaitingList } from '@/api/entities';

export default function WaitingListActionModal({ isOpen, onClose, entry, service, onBooked, onRemoved }) {
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

  const handleBookOriginalTime = async () => {
    try {
      await WaitingList.assign(entry.id);
      onBooked();
      handleClose();
    } catch (error) {
      console.error("Error booking appointment:", error);
      const message = error?.payload?.message || error?.message || "שגיאה בקביעת התור";
      alert(message);
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
      alert(message);
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
        <Button onClick={handleBookOriginalTime} className="h-auto py-3 flex flex-col gap-1 items-center justify-center rounded-2xl bg-green-600 hover:bg-green-700 text-white">
          <Check className="w-5 h-5"/>
          <span className="text-xs font-medium">קבע בזמן המבוקש</span>
        </Button>
      </div>

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
