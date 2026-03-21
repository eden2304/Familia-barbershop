import { useState, useEffect, useMemo } from "react";
import api from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Sparkles, UserRound, X } from "lucide-react";
import { useSystemPopup } from "@/components/SystemPopupProvider";
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

const normalizePhone = (phone = "") => {
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('972')) return `0${cleaned.substring(3)}`;
  if (cleaned.length === 9 && cleaned.startsWith('5')) return `0${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith('05')) return cleaned;
  return cleaned.startsWith('0') ? cleaned : `0${cleaned}`;
};

const getWeekDays = (weekOffset = 0) => {
  const base = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(base, i));
};

const normalizeClientName = (client) => `${client?.first_name || client?.firstName || ''} ${client?.last_name || client?.lastName || ''}`.trim();

export default function AdminAppointmentForm({
  onSubmit,
  onCancel,
  services,
  clients,
  initialDate = null,
  initialSlot = null,
  lockDateTime = false,
}) {
  const [selectedService, setSelectedService] = useState(null);
  const [selectedDay, setSelectedDay] = useState(initialDate);
  const [selectedSlot, setSelectedSlot] = useState(initialSlot);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [formData, setFormData] = useState({
    client_name: "",
    phone: "",
  });
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [availableByDate, setAvailableByDate] = useState({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const { showAlert } = useSystemPopup();

  useEffect(() => {
    setSelectedDay(initialDate instanceof Date && !Number.isNaN(initialDate.getTime()) ? initialDate : null);
  }, [initialDate]);

  useEffect(() => {
    setSelectedSlot(initialSlot?.time instanceof Date && !Number.isNaN(initialSlot.time.getTime()) ? initialSlot : null);
  }, [initialSlot]);

  useEffect(() => {
    if (!initialDate || lockDateTime !== true) return;
    const weekStart = startOfWeek(initialDate, { weekStartsOn: 0 });
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
    const diffWeeks = Math.max(0, Math.round((weekStart.getTime() - currentWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    setSelectedWeek(diffWeeks);
  }, [initialDate, lockDateTime]);

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
    const duration = Number(service?.duration_minutes ?? service?.durationMinutes ?? service?.duration ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  };

  const getAvailableSlotsForDay = (date) => {
    if (!date) return [];
    return availableByDate[toYMD(date)] || [];
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, client_name: value }));

    if (value.trim().length > 0 && clients) {
      const term = value.trim().toLowerCase();
      const filteredSuggestions = clients.filter((client) => {
        const fullName = normalizeClientName(client).toLowerCase();
        const phone = String(client?.phone || '').toLowerCase();
        return fullName.includes(term) || phone.includes(term);
      }).slice(0, 8);
      setSuggestions(filteredSuggestions);
    } else {
      setSuggestions([]);
    }
  };

  const handleSuggestionClick = (client) => {
    setFormData((prev) => ({
      ...prev,
      client_name: normalizeClientName(client),
      phone: client?.phone || ''
    }));
    setSuggestions([]);
  };

  const availableSlotsForSelectedDay = selectedDay ? getAvailableSlotsForDay(selectedDay) : [];
  const selectedDateTimeLabel = selectedSlot?.time
    ? `${format(selectedSlot.time, 'EEEE', { locale: he })} · ${format(selectedSlot.time, 'dd/MM')} · ${format(selectedSlot.time, 'HH:mm')}`
    : null;

  const handleBack = () => {
    if (selectedSlot && !lockDateTime) {
      setSelectedSlot(null);
      return;
    }
    if (selectedDay && !lockDateTime) {
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
      await showAlert("נא למלא את כל השדות");
      return;
    }

    setLoading(true);

    try {
      const startTime = selectedSlot.time;
      const endTime = addMinutes(startTime, resolveServiceDuration(selectedService));
      const normalizedPhone = normalizePhone(formData.phone);

      const appointmentData = {
        service_id: selectedService.id,
        client_name: formData.client_name,
        phone: normalizedPhone,
        starts_at: startTime.toISOString(),
        ends_at: endTime.toISOString(),
        status: "booked"
      };

      await onSubmit(appointmentData);
      setFormData({ client_name: "", phone: "" });
      setSelectedService(null);
      if (!lockDateTime) {
        setSelectedDay(null);
        setSelectedSlot(null);
      }
    } catch (error) {
      console.error("Error creating appointment:", error);
      await showAlert("שגיאה ביצירת התור. אנא נסה שוב.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-3xl shadow-lg w-full max-w-md mx-auto">
      <div className="space-y-4">
        <div className="relative mb-4 pt-10 min-h-16 flex items-center justify-center">
          <Button variant="ghost" size="icon" onClick={onCancel} className="rounded-full absolute right-0 top-0" aria-label="סגירת חלון">
            <X className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleBack} className="rounded-full absolute right-0 top-10" aria-label="חזרה לשלב הקודם">
            <ChevronRight className="w-5 h-5" />
          </Button>
          <div className="text-center">
            <h3 className="text-xl font-bold text-gray-900">הוספת תור חדש</h3>
            <p className="text-sm text-gray-500">אותו תהליך מוכר, רק יותר מהר.</p>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {!selectedService ? (
            <motion.div key="services" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              {lockDateTime && selectedDateTimeLabel ? (
                <div className="mb-4 rounded-2xl border border-amber-100 bg-gradient-to-l from-amber-50 to-white p-4 text-right shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge className="rounded-full bg-black px-3 py-1 text-white hover:bg-black">מהיומן השבועי</Badge>
                    <Sparkles className="h-4 w-4 text-amber-500" />
                  </div>
                  <div className="space-y-1 text-sm text-gray-700">
                    <div className="flex items-center justify-end gap-2"><span>{selectedDateTimeLabel}</span><Clock3 className="h-4 w-4" /></div>
                    <div className="flex items-center justify-end gap-2"><span>נבחרה משבצת פנויה ביומן</span><CalendarDays className="h-4 w-4" /></div>
                  </div>
                </div>
              ) : null}
              <h2 className="text-xl font-bold text-gray-900 mb-4">בחירת שירות</h2>
              <div className="space-y-3">
                {services?.map((service) => (
                  <motion.button
                    type="button"
                    key={service.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedService(service)}
                    className="relative w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-200 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all text-right"
                  >
                    <div className="absolute top-2 left-2 bg-black text-white px-2 py-1 rounded-md font-bold text-xs">
                      ₪{service.price}
                    </div>
                    <div className="text-center">
                      <h3 className="text-base font-bold text-gray-900">{service.name}</h3>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : !selectedDay ? (
            <motion.div key="days" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
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
            <motion.div key="times" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-4">{format(selectedDay, 'EEEE, dd/MM', { locale: he })}</h2>
              <div className="max-h-80 overflow-y-auto space-y-3 p-1">
                {loadingSlots && <p className="text-gray-500 text-sm mt-2">טוען שעות פנויות...</p>}
                {availableSlotsForSelectedDay.map((slot, index) => (
                  <Button key={index} onClick={() => setSelectedSlot(slot)} variant="outline" className="w-full h-12 rounded-2xl bg-white hover:border-black font-medium text-base">
                    {slot.formatted}
                  </Button>
                ))}
                {availableSlotsForSelectedDay.length === 0 && <p className="text-gray-500 text-sm mt-4">אין תורים פנויים ביום זה.</p>}
              </div>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <h2 className="text-xl font-bold text-gray-900 mb-3">פרטי הלקוח</h2>
              {selectedDateTimeLabel ? (
                <div className="mb-5 rounded-2xl bg-gray-50 border border-gray-200 px-4 py-3 text-right text-sm text-gray-700">
                  <div className="flex items-center justify-end gap-2 font-semibold text-gray-900"><span>{selectedService?.name}</span><Sparkles className="h-4 w-4 text-amber-500" /></div>
                  <div className="mt-2 flex items-center justify-end gap-2"><span>{selectedDateTimeLabel}</span><Clock3 className="h-4 w-4 text-gray-500" /></div>
                </div>
              ) : null}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative text-right">
                  <Input placeholder="שם הלקוח או טלפון" value={formData.client_name} onChange={handleNameChange} required className="h-12 text-right" />
                  <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400"><UserRound className="h-4 w-4" /></div>
                  {suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-lg z-10 max-h-52 overflow-y-auto text-right">
                      {suggestions.map((client) => (
                        <button
                          type="button"
                          key={client.id}
                          onClick={() => handleSuggestionClick(client)}
                          className="w-full p-3 hover:bg-gray-50 cursor-pointer text-right"
                        >
                          <p className="font-medium">{normalizeClientName(client) || 'ללא שם'}</p>
                          <p className="text-sm text-gray-500">{client.phone}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Input type="tel" placeholder="טלפון" value={formData.phone} onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))} required className="h-12 text-right" />
                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={onCancel} className="flex-1 rounded-full py-3">ביטול</Button>
                  <Button type="submit" disabled={loading} className="flex-1 bg-black text-white rounded-full py-3 hover:bg-gray-800">
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
