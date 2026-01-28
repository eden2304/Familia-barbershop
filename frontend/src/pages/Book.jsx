import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ChevronLeft, ChevronRight, AlertCircle, Scissors, Calendar,
  CheckCircle2, Clock, Clock4, Zap, Tag, Lock
} from "lucide-react";
import { format, addDays, startOfWeek, startOfDay, isBefore, isSameDay, differenceInCalendarDays } from "date-fns";
import { he } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import VerificationModal from "../components/VerificationModal.jsx";
import WaitingListModal from "../components/WaitingListModal.jsx";
import LoadingScreen from "../components/LoadingScreen.jsx";
import { DEFAULT_BOOKING_RULES, normalizeBookingRules } from "@/lib/booking-rules";

// ✅ API החדש
import api, { API_ROOT } from "@/api/base44Client";
import { getStoredAuthToken, clearStoredAuth } from '@/utils/authStorage';
const API_URL = API_ROOT ?? "http://localhost:3001";


/* ---------------- utils ---------------- */
const normalizePhone = (phone) => {
  const cleaned = (phone || "").replace(/\D/g, "");
  if (cleaned.startsWith("972")) return `0${cleaned.slice(3)}`;
  if (cleaned.length === 9 && cleaned.startsWith("5")) return `0${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith("05")) return cleaned;
  return cleaned.startsWith("0") ? cleaned : `0${cleaned}`;
};

const normalizeClientObject = (raw) => {
  if (!raw) return null;
  const firstName = raw.first_name ?? raw.firstName ?? "";
  const lastName = raw.last_name ?? raw.lastName ?? "";
  const memberFlag = Boolean(raw.isMember ?? raw.is_member ?? false);
  const adminFlag = Boolean(raw.isAdmin ?? raw.is_admin ?? false);
  const fullName = `${firstName} ${lastName}`.trim();
  return {
    id: raw.id,
    phone: raw.phone,
    first_name: firstName,
    last_name: lastName,
    firstName,
    lastName,
    name: raw.name ?? fullName,
    client_name: raw.client_name ?? fullName,
    isMember: memberFlag,
    is_member: memberFlag,
    isAdmin: adminFlag,
    is_admin: adminFlag,
  };
};


const DAYS_IN_WEEK = [
  { key: 0, name: "ראשון" },
  { key: 1, name: "שני" },
  { key: 2, name: "שלישי" },
  { key: 3, name: "רביעי" },
  { key: 4, name: "חמישי" },
  { key: 5, name: "שישי" },
  { key: 6, name: "שבת" },
];

const buildWeekDays = (weekOffset) => {
  const start = startOfWeek(new Date(), { weekStartsOn: 0 });
  const base = addDays(start, weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(base, i));
};

// שמירת API ישן שמרפררים אליו קומפוננטים אחרים
const getWeekDays = (weekOffset = 0) => buildWeekDays(weekOffset);

const toYMD = (d) => {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  // פורמט מקומי: yyyy-mm-dd לפי השעון המקומי (ללא UTC)
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const combineDateTime = (date, hhmm) => {
  const [hh, mm] = String(hhmm).split(":").map(Number);
  const d = new Date(date);
  d.setHours(hh, mm, 0, 0);
  return d;
};

const timeStringToMinutes = (value) => {
  const [hh, mm] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
};

const extractSlotTimes = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
      .map((entry) => {
        if (typeof entry === "string") {
          return { hhmm: entry, memberOnly: false };
        }
        if (entry && typeof entry === "object") {
          const hhmm =
              entry.hhmm ||
              entry.time ||
              entry.slot ||
              entry.startsAt ||
              entry.start ||
              entry.formatted ||
              null;
          if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return null;
          return {
            hhmm,
            memberOnly: Boolean(
                entry.memberOnly ??
                entry.membersOnly ??
                entry.members_only ??
                entry.member_only ??
                false
            ),
            formatted: entry.formatted,
          };
        }
        return null;
      })
      .filter((val) => val && typeof val.hhmm === "string" && val.hhmm.includes(":"));
};

const mergeSlotViews = (publicTimes, memberTimes) => {
  const publicSet = new Set(publicTimes);
  const memberSetSource = memberTimes.length > 0 ? memberTimes : publicTimes;
  const memberSet = new Set(memberSetSource);
  const combined = new Set([...memberSet, ...publicSet]);
  const sorted = Array.from(combined).sort((a, b) => {
    const aMin = timeStringToMinutes(a);
    const bMin = timeStringToMinutes(b);
    if (aMin == null || bMin == null) {
      return String(a).localeCompare(String(b));
    }
    return aMin - bMin;
  });
  return sorted.map((hhmm) => ({
    hhmm,
    memberOnly: !publicSet.has(hhmm),
  }));
};

function getClosingDateFor(d, businessHours) {
  try {
    const dow = d.getDay(); // 0=ראשון ... 6=שבת
    const row = (businessHours || []).find(
        x => (x.day_of_week ?? x.weekday ?? x.day) === dow
    );
    const closeStr = row?.closes_at ?? row?.close_at ?? row?.closing_time ?? row?.end ?? row?.close;
    if (!closeStr) return null;
    const [hh, mm] = String(closeStr).split(':').map(Number);
    const out = new Date(d);
    out.setHours(hh || 0, mm || 0, 0, 0);
    return out;
  } catch {
    return null;
  }
}


function isFutureSlot(dateObj, hhmm) {
  // dateObj = today/date user selected (Date)
  // hhmm = "HH:MM"
  const slotStart = combineDateTime(dateObj, hhmm);
  const now = new Date();
  // אם זה לא היום – אין מגבלה, זה עתיד
  if (!isSameDay(slotStart, now)) return true;
  // אם זה היום – לא לאפשר סלוטים שכבר התחילו/עברו (עם מרווח בטיחות של 60 שניות)
  return slotStart.getTime() > now.getTime() + 60 * 1000;
}


/* ---------------- component ---------------- */
export default function Book() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [client, setClient] = useState(null);
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);

  // נשארים עבור מודל רשימת המתנה בלבד (לא נחוצים לזמינות/קביעת תור)
  const [businessHours, setBusinessHours] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [blockedTimes, setBlockedTimes] = useState([]);
  const [bookingRules, setBookingRules] = useState(() => ({ ...DEFAULT_BOOKING_RULES }));

  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // זמינות מהשרת: {'yyyy-MM-dd': ['HH:MM', ...]}
  const [availableByDate, setAvailableByDate] = useState({});
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [showWaitingList, setShowWaitingList] = useState(false);
  const [showPostLoginLoading, setShowPostLoginLoading] = useState(false);

  const getInitialWeekOffset = () => (new Date().getDay() === 6 ? 1 : 0);
  const [selectedWeek, setSelectedWeek] = useState(getInitialWeekOffset());

  const [aptsLoading, setAptsLoading] = useState(false);

  const clientIsMember = Boolean(client?.isMember ?? client?.is_member);
  const maxAdvanceDays = clientIsMember
      ? bookingRules.memberMaxAdvanceDays
      : bookingRules.publicMaxAdvanceDays;
  const membersOnlyIds = useMemo(
      () => (bookingRules.memberOnlyServiceIds || []).map((id) => String(id)),
      [bookingRules.memberOnlyServiceIds]
  );
  const membersOnlySet = useMemo(() => new Set(membersOnlyIds), [membersOnlyIds]);

  const isWithinBookingWindow = useCallback((date) => {
    if (!date) return false;
    const start = startOfDay(date);
    const today = startOfDay(new Date());
    const diff = differenceInCalendarDays(start, today);
    return diff <= maxAdvanceDays;
  }, [maxAdvanceDays]);

  const canViewWeek = useCallback((weekOffset) => {
    const days = getWeekDays(weekOffset);
    return days.some((d) => isWithinBookingWindow(d));
  }, [isWithinBookingWindow]);

  const canGoForward = useMemo(() => canViewWeek(selectedWeek + 1), [canViewWeek, selectedWeek]);

  const visibleWeekDays = useMemo(() => getWeekDays(selectedWeek), [selectedWeek]);

  const refreshClientFromServer = useCallback(async (phone) => {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return;
    try {
      const res = await api.get(`/clients/lookup?phone=${encodeURIComponent(normalizedPhone)}`);
      if (res && (res.phone || res.client_phone)) {
        const stored = (() => {
          try {
            return JSON.parse(localStorage.getItem("familiaClient") || "null");
          } catch {
            return null;
          }
        })();
        const normalized = normalizeClientObject({
          ...res,
          phone: res.phone ?? res.client_phone ?? normalizedPhone,
          isAdmin: stored?.isAdmin ?? stored?.is_admin ?? res.isAdmin ?? res.is_admin,
        });
        if (normalized) {
          setClient(normalized);
          localStorage.setItem("familiaClient", JSON.stringify(normalized));
        }
      }
    } catch (error) {
      console.warn("Failed to refresh client membership", error);
    }
  }, []);

  useEffect(() => {
    if (!canViewWeek(selectedWeek)) {
      let next = selectedWeek;
      while (next > 0 && !canViewWeek(next)) {
        next -= 1;
      }
      if (next !== selectedWeek) {
        setSelectedWeek(next);
      }
    }
  }, [canViewWeek, selectedWeek]);

  useEffect(() => {
    if (selectedDate && !isWithinBookingWindow(selectedDate)) {
      setSelectedDate(null);
      setSelectedTimeSlot(null);
      setShowForm(false);
    }
  }, [selectedDate, isWithinBookingWindow]);

  useEffect(() => {
    if (!clientIsMember && selectedService) {
      const currentId = String(selectedService.id ?? "");
      if (membersOnlySet.has(currentId)) {
        setSelectedService(null);
        setSelectedDate(null);
        setSelectedTimeSlot(null);
        setShowForm(false);
        setStep(1);
        setError("השירות שנבחר פתוח כעת לחברי מועדון בלבד.");
      }
    }
  }, [clientIsMember, selectedService, membersOnlySet]);

  /* -------- init: client + services -------- */
  useEffect(() => {
    const stored = localStorage.getItem("familiaClient");
    const token = getStoredAuthToken();
    if (stored && token) {
      try {
        const parsed = normalizeClientObject(JSON.parse(stored));
        setClient(parsed);
        refreshClientFromServer(parsed?.phone);
      } catch {
        localStorage.removeItem("familiaClient");
        clearStoredAuth();
        setClient(null);
        navigate("/");
        return;
      }
    } else {
      localStorage.removeItem("familiaClient");
      clearStoredAuth();
      setClient(null);
      navigate("/");
      return;
    }
    loadInitialData();
  }, [navigate, refreshClientFromServer]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [servicesData, bookingRulesSetting, bh] = await Promise.all([
        api.Service.list().catch(() => []),
        api.Setting?.get ? api.Setting.get('booking.rules').catch(() => null) : Promise.resolve(null),
        api.BusinessHours?.list?.().catch(() => []),
      ]);

      // אל תסנן לפי .active (לא קיים בבאק); אם יש isActive=false – נסיר
      setServices((servicesData || []).filter((s) => s.isActive !== false));

      const normalizedRules = normalizeBookingRules(bookingRulesSetting?.value);
      setBookingRules(normalizedRules);

      // לשימוש עתידי במודלים אחרים – משאירים ריק כאן
      setBusinessHours(Array.isArray(bh) ? bh : []);
      setAppointments([]);
      setBlockedTimes([]);
    } catch (e) {
      console.error("Error loading initial data:", e);
      // לא מראים באנר אם שירותים לא קרסו – המסך ממשיך לעבוד
    } finally {
      setLoading(false);
    }
  };

  /* -------- helpers -------- */
  // טען זמינות ל־7 הימים המוצגים בכל שינוי שירות/שבוע
  useEffect(() => {
    const svcId = selectedService?.id;
    if (!svcId) {
      setAvailableByDate({});
      return;
    }

    setLoadingSlots(true);

    const t = setTimeout(() => {
      const weekDays = visibleWeekDays;

      Promise.all(
          weekDays.map(async (d) => {
            const ymd = toYMD(d);

            if (!isWithinBookingWindow(d)) {
              return [ymd, []];
            }

            try {
              // ✅ קריאה אחת בלבד
              const raw = await api.Appointment.getAvailable(svcId, ymd, { isMember: clientIsMember === true });
              const slots = extractSlotTimes(raw);

              const view = slots.map((slot) => ({
                hhmm: slot.hhmm,
                memberOnly: Boolean(slot.memberOnly),
                formatted: slot.formatted ?? slot.hhmm,
              }));

              return [ymd, view];

            } catch (e) {
              console.warn("availability failed for", ymd, e);
              return [ymd, []];
            }
          })
      )
          .then((entries) => {
            const map = {};
            for (const [k, v] of entries) map[k] = v;
            setAvailableByDate(map);
          })
          .finally(() => setLoadingSlots(false));
    }, 300); // ⏱ debounce 300ms

    return () => clearTimeout(t);
  }, [
    selectedService?.id,
    selectedWeek,
    clientIsMember,
    visibleWeekDays,
    isWithinBookingWindow,
  ]);


  useEffect(() => {
    // נטען תורים רק אם:
    // - המודאל של רשימת המתנה פתוח
    // - ויש תאריך נבחר
    if (!showWaitingList || !selectedDate) return;

    const fetchDayAppointments = async () => {
      try {
        setAptsLoading(true);
        const ymd = toYMD(selectedDate);           // "yyyy-MM-dd"
        const res = await fetch(`${API_URL}/appointments?date=${ymd}`);
        const data = await res.json();
        // ה־WaitingListModal מצפה לרשימה מלאה של תורים של אותו יום
        setAppointments(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Failed to load day appointments for waiting list:", e);
        setAppointments([]); // לא להפיל את ה־UI
      } finally {
        setAptsLoading(false);
      }
    };

    fetchDayAppointments();
  }, [showWaitingList, selectedDate]);

  useEffect(() => {
    // כשנכנסים למסך ימים/שעות, נבטל פוקוס אוטומטי שאולי נשאר מכפתורים
    if (document && document.activeElement && document.activeElement !== document.body) {
      try { document.activeElement.blur(); } catch (_) {}
    }
  }, [step]);



  /* -------- handlers -------- */
  const handleServiceSelect = (service) => {
    setSelectedService(service);
    setSelectedDate(null);
    setSelectedTimeSlot(null);
    setAvailableByDate({});
    setStep(2);
    setError(null);
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedTimeSlot(null);
    setStep(3);
    setError(null);
  };

  const handleTimeSelect = (slot) => {
    const hhmm = slot?.hhmm;
    if (!hhmm) return;
    if (slot.memberOnly && !clientIsMember) {
      setError("השעה שנבחרה זמינה לחברי מועדון בלבד.");
      return;
    }
    if (!isFutureSlot(selectedDate, hhmm)) {
      setError("השעה שבחרת כבר עברה. בחר/י שעה אחרת.");
      return;
    }
    const dt = combineDateTime(selectedDate, hhmm);
    setSelectedTimeSlot({
      time: dt,
      hhmm,
      formatted: slot.formatted ?? hhmm,
      memberOnly: Boolean(slot.memberOnly),
    });
    setShowForm(true);
    setError(null);
  };


  const handleUrgentAppointment = () => {
    const clientName = client ? `${client.first_name} ${client.last_name}`.trim() : "אני";
    const message = `היי חן מה קורה, זה ${clientName}, אני חייב תור דחוף להיום. יש מצב אתה מארגן לי?`;
    const whatsappUrl = `https://wa.me/972523767851?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  if (showPostLoginLoading) {
    return <LoadingScreen />;
  }

  const handleLoginSuccess = (loggedInClient) => {
    const norm = normalizeClientObject(loggedInClient);
    setClient(norm);
    setShowVerification(false);
    setShowPostLoginLoading(true);
    setTimeout(() => {
      navigate("/");
      setShowPostLoginLoading(false);
    }, 1200);
  };

  const handleJoinWaitingList = () => {
    if (client) setShowWaitingList(true);
    else setShowVerification(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const fn = client?.first_name ?? client?.firstName ?? "";
      const ln = client?.last_name  ?? client?.lastName  ?? "";
      if (!fn || !ln) throw new Error("שם הלקוח חסר");
      if (!selectedService || !selectedTimeSlot || !selectedDate) throw new Error("שירות/תאריך/שעה לא נבחרו");

      await api.Appointment.create({
        serviceId: selectedService.id,
        date: toYMD(selectedDate),
        time: selectedTimeSlot.hhmm,
        client: {
          firstName: client.first_name ?? client.firstName,
          lastName:  client.last_name  ?? client.lastName,
          phone: normalizePhone(client.phone),
        },
        note: note?.trim() || undefined,
      });

      setSuccess(true);
      setSelectedService(null);
      setSelectedDate(null);
      setSelectedTimeSlot(null);
      setShowForm(false);
      setNote("");
      await loadInitialData();
    } catch (err) {
      console.error("Appointment creation error:", err);
      setError("שגיאה ביצירת התור: " + (err.code || err.message || "נסה שוב."));
    } finally {
      setLoading(false);
    }
  };

  /* -------- derived -------- */
  const weekDays = visibleWeekDays;
  const availableSlots =
      selectedDate && selectedService
          ? (availableByDate[toYMD(selectedDate)] || [])
              .filter((slot) => slot?.hhmm && isFutureSlot(selectedDate, slot.hhmm))
              .map((slot) => ({
                ...slot,
                time: combineDateTime(selectedDate, slot.hhmm),
                formatted: slot.formatted ?? slot.hhmm,
              }))
          : [];

  /* -------- UI -------- */
  if (loading) {
    return (
        <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
          <div className="flex flex-col items-center">
            <div
                className="loader ease-linear rounded-full border-8 border-t-8 border-gray-200 h-24 w-24 mb-4"
                style={{ borderTopColor: "black" }}
            />
            <p className="text-gray-700 text-lg">טוען נתונים...</p>
          </div>
        </div>
    );
  }

  if (success) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="bg-white rounded-3xl p-8 shadow-2xl max-w-sm mx-auto text-center"
          >
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">התור נקבע בהצלחה!</h2>
            <p className="text-gray-600 mb-8">נתראה בקרוב בפמיליה</p>
            <Button onClick={() => navigate("/")} className="bg-black text-white hover:bg-gray-800 rounded-full px-8 py-3 font-medium w-full">
              חזור למסך הבית
            </Button>
          </motion.div>
        </div>
    );
  }

  return (
      <>
        {showVerification && (
            <VerificationModal
                isOpen={showVerification}
                onClose={() => setShowVerification(false)}
                onSuccess={handleLoginSuccess}
            />
        )}

        {showWaitingList && (
            <WaitingListModal
                isOpen={showWaitingList}
                onClose={() => setShowWaitingList(false)}
                service={selectedService}
                day={selectedDate}
                client={client}
                allAppointments={appointments}
                businessHours={businessHours}
                blockedTimes={blockedTimes}
            />
        )}

        {showForm && selectedService && selectedDate && selectedTimeSlot && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
              <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6"
              >
                {/* כותרת */}
                <h3 className="text-xl font-bold text-center text-gray-900 mb-5">אישור התור</h3>

                {/* כרטיסיות מידע (4 שורות) */}
                <div className="space-y-3 mb-6">
                  {/* שירות */}
                  <div className="w-full bg-gray-100 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <span className="text-sm">שירות</span>
                      <Scissors className="w-4 h-4" />
                    </div>
                    <div className="text-sm font-semibold text-gray-900">{selectedService?.name}</div>
                  </div>

                  {/* תאריך */}
                  <div className="w-full bg-gray-100 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <span className="text-sm">תאריך</span>
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div className="text-sm font-semibold text-gray-900">
                      {format(selectedDate, "dd/MM/yy", { locale: he })}
                    </div>
                  </div>

                  {/* שעה */}
                  <div className="w-full bg-gray-100 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <span className="text-sm">שעה</span>
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="text-sm font-semibold text-gray-900">
                      {selectedTimeSlot?.formatted || selectedTimeSlot?.hhmm}
                    </div>
                  </div>

                  {/* מחיר */}
                  <div className="w-full bg-gray-100 rounded-2xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-500">
                      <span className="text-sm">מחיר</span>
                      <Tag className="w-4 h-4" />
                    </div>
                    <div className="text-sm font-semibold text-gray-900">₪{selectedService?.price}</div>
                  </div>
                </div>

                {/* שגיאה (אם יש) */}
                {error && (
                    <Alert className="mb-4" variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-sm">{error}</AlertDescription>
                    </Alert>
                )}

                {/* כפתורים */}
                <div className="flex items-center gap-3">
                  <Button
                      onClick={() => setShowForm(false)}
                      type="button"
                      variant="outline"
                      className="rounded-full h-11 px-6 flex-1"
                  >
                    ביטול
                  </Button>
                  <Button
                      type="button"
                      onClick={handleCreate}
                      disabled={loading}
                      className="rounded-full h-11 px-6 flex-1 bg-black text-white hover:bg-gray-800"
                  >
                    {loading ? "קובע/ת…" : "אישור התור"}
                  </Button>
                </div>
              </motion.div>
            </div>
        )}

        <div className="flex items-center justify-center p-4" style={{ paddingTop: "120px", paddingBottom: "20px", minHeight: "calc(100vh - 140px)" }}>
          <div className="w-full max-w-sm flex flex-col justify-center">
            {error && (
                <Alert className="mb-4 border-red-200 bg-red-50 rounded-xl">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-700 text-sm">{error}</AlertDescription>
                </Alert>
            )}

            <AnimatePresence mode="wait">
              {step === 1 && (
                  <motion.div key="services" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
                    <div className="mb-6">
                      <h2 className="text-lg font-bold text-gray-900 mb-1">בחירת שירות</h2>
                      <p className="text-gray-600 text-sm">בחר את השירות הרצוי</p>
                    </div>

                    <div className="space-y-3">
                      {services.map((service) => {
                        const serviceId = String(service.id ?? "");
                        const memberOnly = membersOnlySet.has(serviceId);
                        const disabled = memberOnly && !clientIsMember;
                        return (
                            <motion.div
                                key={service.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                whileTap={{ scale: disabled ? 1 : 0.98 }}
                                onClick={() => {
                                  if (disabled) {
                                    setError("השירות פתוח לחברי מועדון בלבד.");
                                    return;
                                  }
                                  handleServiceSelect(service);
                                }}
                                className={`relative bg-white rounded-2xl p-4 shadow-sm border transition-all ${
                                    disabled
                                        ? "border-gray-200 cursor-not-allowed opacity-60"
                                        : "border-gray-200 cursor-pointer hover:shadow-md"
                                }`}
                            >
                              <div className="absolute top-2 left-2 bg-black text-white px-2 py-1 rounded-md font-bold text-xs">₪{service.price}</div>
                              {memberOnly && (
                                  <div className="absolute top-2 right-2 bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md text-xs font-semibold">
                                    חברי מועדון
                                  </div>
                              )}
                              <div className="text-center">
                                <h3 className="text-base font-bold text-gray-900">{service.name}</h3>
                                {disabled && (
                                    <p className="mt-2 text-xs font-medium text-red-600">פתוח לחברי מועדון בלבד</p>
                                )}
                              </div>
                            </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
              )}

              {step === 2 && selectedService && (
                  <motion.div
                      key="days"
                      initial={{opacity: 0}}
                      animate={{opacity: 1}}
                      exit={{opacity: 0}}
                      className="text-center flex flex-col justify-center h-full"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <Button variant="ghost" size="icon" onClick={() => setStep(1)} className="rounded-full">
                        <ChevronRight className="w-5 h-5"/>
                      </Button>
                      <div className="text-center">
                        <h2 className="text-lg font-bold text-gray-900 mb-1">בחר תאריך נוח</h2>
                        <p className="text-gray-600 text-sm">איזה יום מתאים לך?</p>
                      </div>
                      <div className="w-10"/>
                    </div>

                    <div className="flex justify-between items-center mb-6">
                      <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedWeek((p) => (canViewWeek(p + 1) ? p + 1 : p))}
                          disabled={!canGoForward}
                          className="text-gray-600 hover:text-gray-900 disabled:opacity-30 rounded-full p-2"
                      >
                        <ChevronLeft className="w-4 h-4"/>
                      </Button>
                      <span className="text-xs text-gray-500 font-medium">
                    {selectedWeek === 0 ? "השבוע" : `שבוע +${selectedWeek}`}
                  </span>
                      <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedWeek((p) => Math.max(0, p - 1))}
                          disabled={selectedWeek === 0}
                          className="text-gray-600 hover:text-gray-900 disabled:opacity-30 rounded-full p-2"
                      >
                        <ChevronRight className="w-4 h-4"/>
                      </Button>
                    </div>
                    <div className="text-xs text-gray-500 mb-4">
                      {clientIsMember
                          ? `חברי מועדון יכולים להזמין עד ${bookingRules.memberMaxAdvanceDays} ימים קדימה`
                          : `לקוחות רגילים יכולים להזמין עד ${bookingRules.publicMaxAdvanceDays} ימים קדימה – לחברי מועדון יש טווח ארוך יותר`}
                    </div>

                    <div className="space-y-3 flex-1 max-h-none">
                      {weekDays.map((date, i) => {
                        const dayIsPast = isBefore(date, startOfDay(new Date()));
                        const isSaturday = date.getDay() === 6;

                        const isAfterClosingToday =
                            isSameDay(date, new Date()) &&
                            (() => {
                              const closing = getClosingDateFor(date, businessHours);
                              return closing ? new Date() > closing : false;
                            })();

                        const beyondWindow = !isWithinBookingWindow(date);
                        const disabled = isSaturday || dayIsPast || isAfterClosingToday || loadingSlots || beyondWindow;
                        const dayName = DAYS_IN_WEEK.find((d) => d.key === date.getDay())?.name;
                        const title =
                            beyondWindow
                                ? (clientIsMember
                                    ? "תאריך זה מחוץ לטווח ההזמנות"
                                    : "פתוח לחברי מועדון בלבד")
                                : isSaturday
                                    ? "שבת - אין תורים"
                                    : isAfterClosingToday
                                        ? "היום כבר אחרי שעת הסגירה"
                                        : undefined;

                        return (
                            <Button
                                key={i}
                                onClick={() => {
                                  if (!disabled) handleDateSelect(date);
                                }}
                                disabled={disabled}
                                variant="outline"
                                className={`w-full h-12 flex justify-center items-center rounded-xl border transition-all text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${
                                    disabled
                                        ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                        : "border-gray-300 bg-white text-gray-800 hover:border-black hover:bg-gray-50"
                                }`}
                                title={title}
                            >
                        <span>
                          {dayName}, {format(date, "dd/MM")}
                        </span>
                            </Button>
                        );
                      })}
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-200">
                      <Button
                          onClick={handleUrgentAppointment}
                          variant="outline"
                          className="w-full bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100 hover:border-orange-300 rounded-full py-3 font-medium flex items-center justify-center gap-2"
                      >
                        <Zap className="w-4 h-4"/>
                        צריך תור דחוף?
                      </Button>
                    </div>
                  </motion.div>
              )}

              {step === 3 && selectedDate && selectedService && (
                  <motion.div
                      key="times"
                      initial={{opacity: 0}}
                      animate={{opacity: 1}}
                      exit={{opacity: 0}}
                      className="text-center flex flex-col justify-center h-full"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <Button variant="ghost" size="icon" onClick={() => setStep(2)} className="rounded-full">
                        <ChevronRight className="w-5 h-5"/>
                      </Button>
                      <div className="text-center">
                        <h2 className="text-lg font-bold text-gray-900 mb-1">בחר שעה פנויה</h2>
                        <p className="text-gray-600 text-sm">
                          {format(selectedDate, "EEEE, dd MMMM", {locale: he})}
                        </p>
                      </div>
                      <div className="w-10"/>
                    </div>

                    <div
                        className="flex flex-wrap gap-3 justify-center flex-1 overflow-y-auto px-2"
                        style={{ scrollbarWidth: "thin" }}
                    >
                      {availableSlots.length > 0 ? (
                          availableSlots.map((slot) => {
                            const key = `${slot.hhmm}-${slot.memberOnly ? "member" : "all"}`;
                            const isMemberOnly = Boolean(slot.memberOnly);
                            const blockedForClient = isMemberOnly && !clientIsMember;
                            const buttonClasses = blockedForClient
                                ? "border-emerald-200 bg-white text-emerald-700 cursor-not-allowed"
                                : "border-gray-200 bg-white text-gray-900 hover:border-black hover:bg-gray-50";
                            const showLockedIndicator = isMemberOnly && !clientIsMember;
                            return (
                                <Button
                                    key={key}
                                    onClick={() => handleTimeSelect(slot)}
                                    variant="outline"
                                    disabled={blockedForClient}
                                    className={`min-w-[120px] w-[45%] sm:w-[140px] min-h-[64px] rounded-2xl font-semibold text-base transition-colors disabled:opacity-100 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1 text-center ${buttonClasses}`}
                                >
                                  <span className="text-sm leading-tight">{slot.formatted}</span>
                                  {showLockedIndicator && (
                                      <div className="flex flex-col items-center gap-1 w-full">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
                                          <Lock className="w-3 h-3" />
                                          חברי מועדון בלבד
                                        </span>
                                        <span className="text-[10px] text-emerald-600 leading-tight">
                                          הצטרפו למועדון כדי לפתוח שעה זו
                                        </span>
                                      </div>
                                  )}
                                </Button>
                            );
                          })
                      ) : (
                          <div className="text-center py-8 px-4 bg-gray-100 rounded-2xl">
                            <p className="font-semibold text-gray-800 mb-3">לא נותרו תורים פנויים ביום זה</p>
                            <p className="text-sm text-gray-600 mb-4">
                              ניתן להצטרף לרשימת ההמתנה ונעדכן אתכם אם יתפנה תור.
                            </p>
                            <Button onClick={handleJoinWaitingList} className="bg-black text-white rounded-full">
                              הצטרפות לרשימת המתנה
                            </Button>
                          </div>
                      )}
                    </div>

                    {availableSlots.length > 0 && (
                        <div className="mt-6 pt-4 border-t border-gray-200">
                          <Button
                              onClick={handleJoinWaitingList}
                              variant="outline"
                              className="w-full h-14 rounded-2xl border border-gray-300 accent-blue-50 text-gray-800 hover:border-black hover:bg-gray-50 font-medium text-base outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                          >
                            <Clock4 className="w-4 h-4" />
                            כניסה לרשימת המתנה
                          </Button>
                        </div>
                    )}
                  </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </>
  );
}
