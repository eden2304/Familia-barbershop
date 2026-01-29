import React, { useState, useMemo } from 'react';
import { WaitingList } from '@/api/entities';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { format, isSameDay } from 'date-fns';
import { he } from "date-fns/locale";

export default function WaitingListModal({
                                           isOpen,
                                           onClose,
                                           service,
                                           day,
                                           client,
                                           occupiedSlots,
                                           businessHours,
                                           blockedTimes
                                         }) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('select');

  const normalizePhone05 = (phone) => {
    const d = String(phone || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('972')) return '0' + d.slice(3);
    if (d.startsWith('5') && d.length === 9) return '0' + d;
    if (d.startsWith('0') && d.length === 10) return d;
    return d.startsWith('0') ? d : '0' + d;
  };

  const generateUnavailableSlots = () => {
    if (!day) return [];

    const seen = new Set();
    const slots = [];

    (occupiedSlots || []).forEach((slot) => {
      const timeLabel = slot.time ?? slot.desired_time ?? slot.desiredTime;
      let dt = slot.startsAt ?? slot.starts_at ?? slot.desired_starts_at ?? slot.desiredStartsAt;

      let time = null;
      if (dt) {
        const parsed = new Date(dt);
        if (!Number.isNaN(parsed.getTime())) time = parsed;
      } else if (timeLabel) {
        const [hh, mm] = String(timeLabel).split(':');
        const d = new Date(day);
        d.setHours(Number(hh), Number(mm), 0, 0);
        time = d;
      }

      if (!time || Number.isNaN(time.getTime())) return;
      const label = format(time, 'HH:mm');
      if (!seen.has(label)) {
        seen.add(label);
        slots.push({ time, formatted: label });
      }
    });

    slots.sort((a, b) => a.time - b.time);
    return slots;
  };

  // סינון שעות עבר – אם היום הוא היום הנוכחי
  const unavailableSlots = useMemo(() => {
    const list = generateUnavailableSlots();
    if (!day) return list;

    const now = new Date();
    if (!isSameDay(day, now)) return list; // ביום עתידי – מציגים הכל

    // אם זה היום – רק שעות עתידיות (מרווח בטיחות קטן)
    const cutoff = now.getTime() + 60 * 1000;
    return list.filter(s => s.time.getTime() > cutoff);
  }, [day, occupiedSlots]);

  const handleSubmit = async () => {
    if (!selectedSlot || !client || !service) return;
    setLoading(true);
    try {
      const first = (client.first_name ?? client.firstName ?? '').trim();
      const last  = (client.last_name  ?? client.lastName  ?? '').trim();
      const client_name = `${first} ${last}`.trim() || normalizePhone05(client.phone);

      const desiredDate = format(day, 'yyyy-MM-dd');
      const desiredTime = selectedSlot.formatted;
      await WaitingList.create({
        client_id: client.id ?? null,
        client_name,
        phone: normalizePhone05(client.phone),
        service_id: Number(service.id),
        desired_date: desiredDate,
        desired_time: desiredTime,
        desired_starts_at: selectedSlot.time.toISOString(),
        is_club_member: Boolean(client?.is_member ?? client?.isMember ?? false),
      });

      setView('success');
    } catch (error) {
      console.error("Error joining waiting list:", error);
      if (error?.status === 409) {
        alert("אתה כבר רשום לשעה זו.");
      } else {
        alert("שגיאה בהצטרפות לרשימת ההמתנה.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-white rounded-3xl p-6 max-w-sm w-full">
          <AnimatePresence mode="wait">
            {view === 'select' ? (
                <motion.div key="select">
                  <DialogHeader className="text-center mb-4">
                    <DialogTitle className="text-xl font-bold">הצטרפות לרשימת המתנה</DialogTitle>
                    <DialogDescription>
                      {day ? format(day, 'EEEE, dd/MM', { locale: he }) : ''}
                    </DialogDescription>
                  </DialogHeader>

                  <p className="text-center text-sm text-gray-600 mb-4">
                    בחר את השעה התפוסה שעליה תרצה לקבל התראה אם תתפנה
                  </p>

                  <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto p-1">
                    {unavailableSlots.length > 0 ? (
                        unavailableSlots.map((slot) => (
                            <Button
                                key={slot.formatted}
                                variant={selectedSlot?.formatted === slot.formatted ? 'default' : 'outline'}
                                onClick={() => setSelectedSlot(slot)}
                                className={`h-10 text-sm rounded-lg ${selectedSlot?.formatted === slot.formatted ? 'bg-black text-white' : ''}`}
                            >
                              {slot.formatted}
                            </Button>
                        ))
                    ) : (
                        <p className="col-span-3 text-center text-gray-500 py-8">
                          אין שעות מתאימות להצטרפות היום.
                        </p>
                    )}
                  </div>

                  <div className="mt-6 flex flex-col gap-3">
                    <Button
                        onClick={handleSubmit}
                        disabled={!selectedSlot || loading}
                        className="w-full bg-black text-white rounded-full py-3"
                    >
                      {loading ? 'מצטרף...' : 'הצטרף לרשימת ההמתנה'}
                    </Button>
                    <Button onClick={onClose} variant="ghost" className="w-full text-gray-600">
                      ביטול
                    </Button>
                  </div>
                </motion.div>
            ) : (
                <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="text-center p-4"
                >
                  <DialogTitle className="text-2xl font-bold text-green-500 mb-4">
                    הצטרפת בהצלחה!
                  </DialogTitle>
                  <p className="text-gray-700">
                    נכנסת לרשימת ההמתנה לשעה{' '}
                    <span className="font-bold">{selectedSlot?.formatted}</span>.
                    <br />
                    נעדכן אותך אם התור יתפנה.
                  </p>
                  <Button onClick={onClose} className="w-full mt-6 bg-black text-white rounded-full py-3">
                    סגור
                  </Button>
                </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
  );
}
