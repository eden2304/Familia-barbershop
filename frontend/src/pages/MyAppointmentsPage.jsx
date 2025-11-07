import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar, Clock, Check, X, PlusCircle, History, User, AlertCircle } from "lucide-react";
import { format, isAfter, compareAsc } from "date-fns";
import { he } from "date-fns/locale";
import VerificationModal from "../components/VerificationModal.jsx";
import { fullName, serviceName, statusPill } from '@/lib/apt-utils';
import api from "@/api/base44Client";

/* ---------------- utils ---------------- */
const normalizePhone = (phone = "") => {
  const cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.startsWith("972")) return `0${cleaned.slice(3)}`;
  if (cleaned.length === 9 && cleaned.startsWith("5")) return `0${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith("0")) return cleaned;
  return cleaned.startsWith("0") ? cleaned : `0${cleaned}`;
};

const normalizeClientObject = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id,
    phone: raw.phone,
    first_name: raw.first_name ?? raw.firstName ?? "",
    last_name:  raw.last_name  ?? raw.lastName  ?? "",
  };
};

// נרמול אובייקט תור מהשרת → מבנה עקבי
const normAppt = (a) => {
  const starts = a?.startsAt ?? a?.starts_at;
  const ends   = a?.endsAt   ?? a?.ends_at;
  const service = a?.service ?? a?.Service ?? a?.svc;

  const startsDate = starts ? new Date(starts) : null;
  const endsDate   = ends ? new Date(ends) : null;

  return {
    id: a?.id,
    status: a?.status ?? null,

    // Date objects לשימוש פנימי
    startsAt: startsDate,
    endsAt:   endsDate,

    // תאימות לקובצי עזר/קומפוננטות אחרות
    starts_at: startsDate,
    ends_at:   endsDate,

    service: service
        ? {
          id: service.id,
          name: service.name,
          durationMinutes: service.durationMinutes ?? service.duration_minutes,
          price: service.price,
        }
        : null,

    // אם יש client מובנה בתשובה – נשאיר אותו לצרכים עתידיים
    client: a?.client || null,
    client_first_name: a?.client_first_name,
    client_last_name: a?.client_last_name,
    client_phone: a?.client_phone ?? a?.phone,
  };
};


const StatusChip = ({ apt }) => {
  const pill = statusPill(apt);
  const label = pill.label;
  const Icon = label === 'הושלם' ? Check : (label === 'בוטל' ? X : Clock);
  return (
      <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${pill.className}`}>
        <Icon className="w-3 h-3" /> {label}
      </div>
  );
};


/* ---------------- page ---------------- */
export default function MyAppointmentsPage() {
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showVerification, setShowVerification] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("familiaClient");
    if (!raw) {
      setLoading(false); // נציג מסך התחברות
      return;
    }
    try {
      const parsed = normalizeClientObject(JSON.parse(raw));
      setClient(parsed);
      fetchMine(parsed.phone);
    } catch (e) {
      console.error("bad client in storage", e);
      setLoading(false);
    }
  }, []);

  const fetchMine = async (phoneRaw) => {
    setLoading(true);
    setErr("");
    try {
      const phone = normalizePhone(phoneRaw);
      const arr = (await api.Appointment.listMine(phone)) || [];
      const normalized = arr.map(normAppt).filter((x) => x.startsAt);
      normalized.sort((a, b) => compareAsc(a.startsAt, b.startsAt)); // מהקרוב לרחוק
      setItems(normalized);
    } catch (e) {
      console.error("fetch appointments failed", e);
      setErr("שגיאה בטעינת התורים");
    } finally {
      setLoading(false);
    }
  };

  const now = new Date();
  const upcoming = useMemo(
      () => items.filter((i) => isAfter(i.endsAt ?? i.startsAt, now)),
      [items]
  );
  const past = useMemo(
      () => items.filter((i) => !isAfter(i.endsAt ?? i.startsAt, now)),
      [items]
  );

  const handleLoginSuccess = (loggedInClient) => {
    // לתאימות לשני פורמטים
    const norm = normalizeClientObject(loggedInClient);
    localStorage.setItem("familiaClient", JSON.stringify(norm));
    setClient(norm);
    setShowVerification(false);
    fetchMine(norm.phone);
  };

  const handleCancelRequest = (appt) => {
    if (!client) return;
    const dateStr = format(appt.startsAt, "EEEE, dd/MM/yyyy", { locale: he });
    const timeStr = format(appt.startsAt, "HH:mm");
    const clientFirstName = client.first_name || "";
    const msg = `היי חן זה ${clientFirstName}, לצערי אני נאלץ לבטל את התור שלי ב${dateStr} בשעה ${timeStr}. תוכל לבטל לי?`;
    const barberPhone = "0523767851"; // אם תרצה—נחבר ל-Setting מהשרת
    const whatsappUrl = `https://wa.me/972${barberPhone.slice(1)}?text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, "_blank");
  };

  /* ---------------- renders ---------------- */
  if (loading) {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-gray-300 border-t-black rounded-full animate-spin" />
        </div>
    );
  }

  // אין לקוח → הצע התחברות
  if (!client) {
    return (
        <>
          {/* תמיכה בשתי חתימות של המודל */}
          {showVerification && (
              <VerificationModal
                  isOpen={showVerification}
                  onClose={() => setShowVerification(false)}
                  onSuccess={handleLoginSuccess}
                  onVerify={handleLoginSuccess}
                  onCancel={() => setShowVerification(false)}
              />
          )}
          <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 text-center" dir="rtl">
            <div className="bg-white rounded-2xl p-8 shadow-md max-w-sm w-full">
              <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-800 mb-2">צריך להתחבר</h2>
              <p className="text-gray-500 mb-6">כדי לראות את היסטוריית התורים שלך, עליך להתחבר לחשבונך.</p>
              <Button onClick={() => setShowVerification(true)} className="w-full bg-black text-white rounded-full px-8 py-3 font-bold">
                התחברות / הרשמה
              </Button>
            </div>
          </div>
        </>
    );
  }

  return (
      <div className="max-w-xl mx-auto px-4" style={{ paddingTop: "120px", paddingBottom: "24px" }}>
        {err && (
            <Alert className="mb-4 border-red-200 bg-red-50 rounded-xl">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-700 text-sm">{err}</AlertDescription>
            </Alert>
        )}

        {/* אין בכלל תורים */}
        {items.length === 0 && !err ? (
            <Card className="p-8 rounded-3xl text-center shadow-sm">
              <History className="w-10 h-10 mx-auto mb-3 text-gray-400" />
              <h3 className="font-bold text-gray-900 mb-1">אין לך תורים כרגע</h3>
              <p className="text-sm text-gray-600 mb-6">נשמח לראות אותך אצלנו במספרה.</p>
              <Button asChild className="bg-black text-white rounded-full px-6">
                <Link to="/book">
                  <PlusCircle className="w-4 h-4 ml-2" />
                  לקביעת תור חדש
                </Link>
              </Button>
            </Card>
        ) : (
            <>
              {/* תורים קרובים */}
              {upcoming.length > 0 && (
                  <>
                    <h2 className="text-lg font-bold text-gray-900 mb-3 text-right">התורים הקרובים</h2>
                    <div className="space-y-3 mb-8">
                      {upcoming.map((a) => (
                          <Card key={a.id} className="p-5 rounded-2xl border-gray-200">
                            <CardContent className="p-0">
                              <div className="flex items-start justify-between">
                                <div className="text-right">
                                  <div className="text-base font-bold text-gray-900">{serviceName(a)}</div>
                                  <div className="flex items-center gap-2 text-gray-600 mt-1">
                                    <Calendar className="w-4 h-4" />
                                    <span className="text-sm">
                              {format(a.startsAt, "EEEE, dd/MM", { locale: he })}
                            </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-gray-600">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-sm">
                              {format(a.endsAt, "HH:mm")}–{format(a.startsAt ?? a.endsAt, "HH:mm")}
                            </span>
                                  </div>
                                </div>
                                <StatusChip apt={a} />
                              </div>

                              <div className="mt-4 text-center">
                                <Button
                                    onClick={() => handleCancelRequest(a)}
                                    variant="outline"
                                    className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300 rounded-full px-4 py-2 text-sm font-medium"
                                >
                                  מעוניין לבטל את התור?
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                      ))}
                    </div>
                  </>
              )}

              {/* היסטוריית תורים */}
              {past.length > 0 && (
                  <>
                    <h2 className="text-lg font-bold text-gray-900 mb-3 text-right">היסטוריית תורים</h2>
                    <div className="space-y-3">
                      {past.map((a) => (
                          <Card key={a.id} className="p-5 rounded-2xl border-gray-200 opacity-95">
                            <CardContent className="p-0">
                              <div className="flex items-start justify-between">
                                <div className="text-right">
                                  <div className="text-base font-bold text-gray-800">{serviceName(a)}</div>
                                  <div className="flex items-center gap-2 text-gray-600 mt-1">
                                    <Calendar className="w-4 h-4" />
                                    <span className="text-sm">
                              {format(a.startsAt, "dd/MM/yy", { locale: he })}
                            </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-gray-600">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-sm">
                              {format(a.endsAt, "HH:mm")}–{format(a.startsAt ?? a.endsAt, "HH:mm")}
                            </span>
                                  </div>
                                </div>
                                <StatusChip apt={a} />
                              </div>
                            </CardContent>
                          </Card>
                      ))}
                    </div>
                  </>
              )}

              {/* CTA */}
              <div className="mt-8">
                <Button asChild variant="outline" className="w-full rounded-full">
                  <Link to="/book">
                    <PlusCircle className="w-4 h-4 ml-2" />
                    קבע תור נוסף
                  </Link>
                </Button>
              </div>
            </>
        )}
      </div>
  );
}
