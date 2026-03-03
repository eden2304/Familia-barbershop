
import { useState, useEffect, useMemo } from "react";
import api from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { format, addDays, startOfWeek, addMinutes, isBefore, startOfDay } from "date-fns";
import { he } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

const DAYS_IN_WEEK = [
  { key: 0, name: "ראשון", short: "א'" },
  { key: 1, name: "שני", short: "ב'" },
  { key: 2, name: "שלישי", short: "ג'" },
  { key: 3, name: "רביעי", short: "ד'" },
  { key: 4, name: "חמישי", short: "ה'" },
  { key: 5, name: "שישי", short: "ו'" },
  { key: 6, name: "שבת", short: "ש'" }
];

// Phone number normalization utility - consistent format
const normalizePhone = (phone) => {
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('972')) {
    return `0${cleaned.substring(3)}`;
  } else if (cleaned.length === 9 && cleaned.startsWith('5')) {
    return `0${cleaned}`;
  } else if (cleaned.length === 10 && cleaned.startsWith('05')) {
    return cleaned;
  }

  return cleaned.startsWith('0') ? cleaned : `0${cleaned}`;
};

// מחזיר מערך של 7 תאריכים (ראשון-שבת) עבור שבוע עם היסט/אופסט נתון
// weekOffset = 0 השבוע הנוכחי, 1 שבוע הבא, 2+ וכן הלאה
const getWeekDays = (weekOffset = 0) => {
    // מתחילים מראשון (weekStartsOn: 0)
    const base = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(base, i));
};

export default function AdminAppointmentForm({ onSubmit, onCancel, services, clients }) {
  const [selectedService, setSelectedService] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [formData, setFormData] = useState({
    client_name: "",
    phone: "",
    note: ""
  });
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [availableByDate, setAvailableByDate] = useState({});
  const [loadingSlots, setLoadingSlots] = useState(false);

  const weekDays = useMemo(() => getWeekDays(selectedWeek), [selectedWeek]);

  const toYMD = (date) => {
    if (!date) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const extractSlotTimes = (raw) => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        if (typeof entry === "string") return entry;
        const hhmm = entry?.hhmm || entry?.time || entry?.formatted || null;
        return typeof hhmm === "string" && hhmm.includes(":") ? hhmm : null;
      })
      .filter(Boolean);
  };

  useEffect(() => {
    const serviceId = selectedService?.id;
    if (!serviceId) {
      setAvailableByDate({});
      return;
    }

    setLoadingSlots(true);
    Promise.all(
      weekDays.map(async (date) => {
        const ymd = toYMD(date);
        if (isBefore(date, startOfDay(new Date()))) return [ymd, []];

        try {
          const raw = await api.Appointment.getAvailable(serviceId, ymd, { isMember: true });
          const hhmmSlots = extractSlotTimes(raw);
          const slots = hhmmSlots
            .map((hhmm) => {
              const [hours, minutes] = hhmm.split(":").map(Number);
              if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
              const time = new Date(date);
              time.setHours(hours, minutes, 0, 0);
              return {
                date,
                time,
                formatted: format(time, "HH:mm"),
              };
            })
            .filter(Boolean);
          return [ymd, slots];
        } catch (error) {
          console.warn("Failed loading availability for", ymd, error);
          return [ymd, []];
        }
      })
    )
      .then((entries) => {
        const next = {};
        entries.forEach(([dateKey, slots]) => {
          next[dateKey] = slots;
        });
        setAvailableByDate(next);
      })
      .finally(() => setLoadingSlots(false));
  }, [selectedService?.id, weekDays]);

    const resolveServiceDuration = (service) => {
        const duration = Number(
            service?.duration_minutes ??
            service?.durationMinutes ??
            service?.duration ??
            0
        );
        return Number.isFinite(duration) && duration > 0 ? duration : 0;
    };

  const getAvailableSlotsForDay = (date) => {
    if (!date) return [];
    return availableByDate[toYMD(date)] || [];
  };


    const handleNameChange = (e) => {
      const value = e.target.value;
      setFormData({...formData, client_name: value});

      if (value.length > 1 && clients) {
          const filteredSuggestions = clients.filter(client =>
              `${client.first_name || ''} ${client.last_name || ''}`.toLowerCase().includes(value.toLowerCase())
          );
          setSuggestions(filteredSuggestions);
      } else {
          setSuggestions([]);
      }
  };

  const handleSuggestionClick = (client) => {
      setFormData({
          ...formData,
          client_name: `${client.first_name || ''} ${client.last_name || ''}`,
          phone: client.phone || ''
      });
      setSuggestions([]);
  };

  const availableSlotsForSelectedDay = selectedDay ? getAvailableSlotsForDay(selectedDay) : [];

  const handleBack = () => {
    if (selectedSlot) {
      setSelectedSlot(null);
      return;
    }
    if (selectedDay) {
      setSelectedDay(null);
      return;
    }
    if (selectedService) {
      setSelectedService(null);
      return;
    }
    onCancel();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedService || !selectedSlot || !formData.client_name || !formData.phone) {
      alert("נא למלא את כל השדות");
      return;
    }

    setLoading(true);

    try {
      const startTime = selectedSlot.time;
      const endTime = addMinutes(startTime, resolveServiceDuration(selectedService));

      // Normalize phone number before saving
      const normalizedPhone = normalizePhone(formData.phone);

      const appointmentData = {
        service_id: selectedService.id,
        client_name: formData.client_name,
        phone: normalizedPhone, // Use normalized phone
        starts_at: startTime.toISOString(),
        ends_at: endTime.toISOString(),
        note: formData.note || null,
        status: "booked"
      };

      await onSubmit(appointmentData);

      // Reset form and selections after successful submission
      setFormData({ client_name: "", phone: "", note: "" });
      setSelectedService(null);
      setSelectedDay(null);
      setSelectedSlot(null);
    } catch (error) {
      console.error("Error creating appointment:", error);
      alert("שגיאה ביצירת התור. אנא נסה שוב."); // User-friendly error message
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-lg w-full max-w-md mx-auto">
      <div className="space-y-4">
        {/* Back Button and Title */}
        <div className="relative mb-4 h-10 flex items-center justify-center">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleBack}
            className="rounded-full absolute left-0"
            aria-label="חזרה לשלב הקודם"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
          <h3 className="text-xl font-bold text-gray-900 text-center">הוספת תור חדש</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="rounded-full absolute right-0"
            aria-label="סגירת חלון"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
        
        <AnimatePresence mode="wait">
          {!selectedService ? (
            <motion.div
              key="services"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-4">בחירת שירות</h2>
              <div className="space-y-3">
                {services?.map((service) => (
                  <motion.div
                    key={service.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedService(service)}
                    className="relative bg-white rounded-2xl p-4 shadow-sm border border-gray-200 cursor-pointer hover:shadow-md transition-all"
                  >
                    <div className="absolute top-2 left-2 bg-black text-white px-2 py-1 rounded-md font-bold text-xs">
                        ₪{service.price}
                    </div>
                    <div className="text-center">
                      <h3 className="text-base font-bold text-gray-900">{service.name}</h3>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : !selectedDay ? (
            <motion.div
              key="days"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-4">בחירת תאריך</h2>

              <div className="flex justify-between items-center mb-4">
                <Button variant="ghost" size="sm" onClick={() => setSelectedWeek(prev => prev - 1)} disabled={selectedWeek === 0} className="rounded-full p-2"><ChevronRight className="w-4 h-4" /></Button>
                <span className="text-sm font-medium">{selectedWeek === 0 ? "השבוע הנוכחי" : `שבוע +${selectedWeek}`}</span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedWeek(prev => prev + 1)} className="rounded-full p-2"><ChevronLeft className="w-4 h-4" /></Button>
              </div>

              <div className="space-y-2">
                {weekDays.map((date) => {
                  const isPast = isBefore(date, startOfDay(new Date()));
                  const dayName = DAYS_IN_WEEK.find(d => d.key === date.getDay())?.name;
                  const hasSlots = getAvailableSlotsForDay(date).length > 0;

                  return (
                    <Button
                      key={format(date, 'yyyy-MM-dd')}
                      onClick={() => !isPast && hasSlots && setSelectedDay(date)}
                      disabled={isPast || !hasSlots}
                      variant="outline"
                      className={`w-full h-12 justify-center rounded-2xl ${isPast || !hasSlots ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white hover:border-black'}`}
                    >
                      {dayName}, {format(date, 'dd/MM')}
                    </Button>
                  );
                })}
              </div>
            </motion.div>
          ) : !selectedSlot ? (
            <motion.div
              key="times"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-4">{format(selectedDay, 'EEEE, dd/MM', { locale: he })}</h2>

              <div className="max-h-80 overflow-y-auto space-y-3 p-1">
                {loadingSlots && <p className="text-gray-500 text-sm mt-2">טוען שעות פנויות...</p>}
                {availableSlotsForSelectedDay.map((slot, index) => (
                  <Button key={index} onClick={() => setSelectedSlot(slot)} variant="outline" className="w-full h-12 rounded-2xl bg-white hover:border-black font-medium text-base">
                    {slot.formatted}
                  </Button>
                ))}
                {availableSlotsForSelectedDay.length === 0 && (
                    <p className="text-gray-500 text-sm mt-4">אין תורים פנויים ביום זה.</p>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-center"
            >
              <h2 className="text-xl font-bold text-gray-900 mb-6">אישור פרטים</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                    <Input placeholder="שם הלקוח" value={formData.client_name} onChange={handleNameChange} required className="h-12 text-center"/>
                    {suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
                            {suggestions.map(client => (
                                <div
                                    key={client.id}
                                    onClick={() => handleSuggestionClick(client)}
                                    className="p-3 hover:bg-gray-100 cursor-pointer text-right"
                                >
                                    <p className="font-medium">{client.first_name} {client.last_name}</p>
                                    <p className="text-sm text-gray-500">{client.phone}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <Input type="tel" placeholder="טלפון" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} required className="h-12 text-center"/>
                <Textarea placeholder="הערה (אופציונלי)" value={formData.note} onChange={(e) => setFormData({...formData, note: e.target.value})} className="text-center"/>

                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={onCancel} className="flex-1 rounded-full py-3">ביטול</Button>
                  <Button type="submit" disabled={loading} className="flex-1 bg-black text-white rounded-full py-3">
                    {loading ? "יוצר..." : "קבע תור"}
                  </Button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
