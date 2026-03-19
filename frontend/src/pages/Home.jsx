import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Star, ChevronLeft, ChevronRight, Instagram, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import VideoGallery from "../components/VideoGallery.jsx";
import ProductGallery from "../components/ProductGallery.jsx";
import VerificationModal from "../components/VerificationModal.jsx";
import LoadingScreen from "../components/LoadingScreen.jsx";
import { getStoredAuthToken, clearStoredAuth } from '@/utils/authStorage';
import api from "@/api/base44Client";
import { findNextFutureRecurringAppointment, getAppointmentDate } from "@/lib/recurring-indicators";

const WhatsAppIcon = ({ className = "w-8 h-8" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M20.52 3.48A11.86 11.86 0 0 0 12.07 0C5.5 0 .16 5.34.16 11.91c0 2.1.55 4.15 1.59 5.96L0 24l6.3-1.65a11.9 11.9 0 0 0 5.77 1.47h.01c6.57 0 11.91-5.34 11.91-11.91 0-3.18-1.24-6.17-3.47-8.43Zm-8.45 18.33h-.01a9.9 9.9 0 0 1-5.04-1.38l-.36-.22-3.74.98 1-3.65-.24-.37a9.88 9.88 0 0 1-1.52-5.26c0-5.45 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.9 6.99c0 5.45-4.44 9.9-9.89 9.9Zm5.43-7.42c-.3-.15-1.78-.88-2.06-.98-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.23-.65.08-.3-.15-1.27-.47-2.41-1.49-.89-.8-1.49-1.78-1.66-2.08-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.08-.15-.68-1.65-.94-2.25-.25-.6-.5-.5-.68-.51h-.58c-.2 0-.53.08-.8.38-.28.3-1.05 1.03-1.05 2.5 0 1.48 1.08 2.91 1.23 3.11.15.2 2.12 3.24 5.14 4.54.72.31 1.28.5 1.71.64.72.23 1.37.2 1.89.12.58-.09 1.78-.73 2.03-1.44.25-.7.25-1.3.18-1.43-.08-.13-.28-.2-.58-.35Z" />
  </svg>
);

const TikTokIcon = ({ className = "w-7 h-7" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.47V2h-3.11v12.4a2.89 2.89 0 1 1-2-2.75V8.48a6 6 0 1 0 5.14 5.93V8.09a7.92 7.92 0 0 0 4.63 1.49V6.69h-.89Z" />
  </svg>
);

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const resolveVideoUrl = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(API_URL || "").replace(/\/+$/, "");
  if (value.startsWith("/")) return `${base}${value}`;
  return `${base}/${value}`;
};

export default function Home() {
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [testimonials, setTestimonials] = useState([]);
  const [testimonialPage, setTestimonialPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showVerification, setShowVerification] = useState(false);
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState("");
  const [showAboutText, setShowAboutText] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [futureRecurringAppointment, setFutureRecurringAppointment] = useState(null);

  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    const t = setTimeout(() => setShowLoadingScreen(false), 2200);
    const controller = new AbortController();

    const storedClient = localStorage.getItem("familiaClient");
    const token = getStoredAuthToken();
    try {
      if (storedClient && storedClient !== "undefined" && token) {
        const parsed = JSON.parse(storedClient);
        if (parsed && typeof parsed === "object") setClient(parsed);
      } else {
        localStorage.removeItem("familiaClient");
        clearStoredAuth();
        setClient(null);
      }
    } catch {
      localStorage.removeItem("familiaClient");
      clearStoredAuth();
      setClient(null);
    }


    loadData(controller.signal);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, []);

  const loadData = async (signal) => {
    setLoading(true);
    try {
      const token = getStoredAuthToken();
      const storedClientPhone = client?.phone || (() => {
        try {
          const stored = JSON.parse(localStorage.getItem('familiaClient') || 'null');
          return stored?.phone || null;
        } catch {
          return null;
        }
      })();
      const shouldLoadFutureRecurring = Boolean(token && storedClientPhone);

      const [raw, bg, myAppointments] = await Promise.all([
        api.get('/testimonials', { signal }).catch(() => []),
        api.get('/background-videos', { signal }).catch(() => []),
        shouldLoadFutureRecurring ? api.Appointment.listMine().catch(() => []) : Promise.resolve([]),
      ]);

      const testiFromApi = Array.isArray(raw)
          ? raw.map((t, idx) => ({
            id: t?.id ?? `testimonial-${idx}`,
            author: t?.author || "לקוח מרוצה",
            rating: Number.isFinite(Number(t?.rating)) ? Number(t.rating) : 5,
            text: (t?.text ?? t?.content ?? '').toString(),
            content: (t?.content ?? t?.text ?? '').toString(),
          }))
          : [];

      if (!signal?.aborted) setTestimonials(testiFromApi);

      const active = Array.isArray(bg) ? (bg.find((v) => v.isActive || v.is_active) || bg[0]) : null;
      const rawUrl = active?.imageUrl
        || active?.image_url
        || active?.fullUrl
        || active?.full_url
        || active?.videoUrl
        || active?.video_url
        || active?.url
        || "";
      if (!signal?.aborted) setBackgroundVideoUrl(resolveVideoUrl(rawUrl));

      const nextRecurring = findNextFutureRecurringAppointment(myAppointments, client ?? (() => {
        try {
          return JSON.parse(localStorage.getItem('familiaClient') || 'null');
        } catch {
          return null;
        }
      })());
      if (!signal?.aborted) setFutureRecurringAppointment(nextRecurring);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error("Error loading data:", err);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };


  const handleBookingClick = () => {
    if (client && client.phone) {
      sessionStorage.setItem("showBookingUpdates", "true");
      navigate("/Book");
    }
    else setShowVerification(true);
  };

  const handleLoginSuccess = (loggedInClient) => {
    try {
      const c = (loggedInClient && typeof loggedInClient === "object") ? loggedInClient : {};
      const fn = c.firstName || c.first_name || "";
      const ln = c.lastName  || c.last_name  || "";
      const memberFlag = Boolean(c.isMember ?? c.is_member ?? false);
      const adminFlag = Boolean(c.isAdmin ?? c.is_admin ?? false);
      const payload = {
        ...c,
        phone: (c.phone || "").toString(),
        firstName: fn,
        lastName:  ln,
        first_name: fn,
        last_name:  ln,
        isMember: memberFlag,
        is_member: memberFlag,
        isAdmin: adminFlag,
        is_admin: adminFlag,
        client_name: `${fn.trim()} ${ln.trim()}`.trim() || (c.phone || ""),
        name: `${fn.trim()} ${ln.trim()}`.trim() || (c.phone || "")
      };
      localStorage.setItem("familiaClient", JSON.stringify(payload));
      setClient(payload);
      setShowVerification(false);
      setShowLoadingScreen(true);

      setTimeout(() => {
        navigate("/");
        setShowLoadingScreen(false);
      }, 1200);
    } catch (error) {
      console.error("Error handling login success:", error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("familiaClient");
    clearStoredAuth();
    setClient(null);
    try {
      window.dispatchEvent(new Event('familia-auth-changed'));
    } catch {
      // ignore
    }
    window.location.reload();
  };

  const totalTestimonialPages = testimonials.length > 0 ? Math.ceil(testimonials.length / 3) : 1;
  const testimonialsToShow = testimonials.slice(testimonialPage * 3, testimonialPage * 3 + 3);
  const futureRecurringLabel = useMemo(() => {
    const startsAt = getAppointmentDate(futureRecurringAppointment);
    if (!startsAt) return '';
    return `${format(startsAt, 'EEEE, d בMMMM', { locale: he })} בשעה ${format(startsAt, 'HH:mm')}`;
  }, [futureRecurringAppointment]);

  return (
      <>
        {showLoadingScreen && <LoadingScreen />}
        {showVerification && (
            <VerificationModal
                onVerify={handleLoginSuccess}
                onCancel={() => setShowVerification(false)}
            />
        )}

        <div className="bg-black">
          {/* וידאו רקע */}
          <section className="fixed top-0 left-0 h-screen w-full z-0">
            <video
                key={backgroundVideoUrl || "fallback"}
                className="absolute inset-0 w-full h-full object-cover"
                src={
                  backgroundVideoUrl
                    // backgroundVideoUrl ||
                    // "/videos/backgroundVideo.mp4"
                }
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
            />
            <div className="absolute inset-0 bg-black/40"></div>
          </section>

          {/* גוף הדף */}
          <section
              className="relative z-10 bg-gray-50 rounded-t-3xl mt-[60vh]"
              style={{ paddingBottom: "60px" }}
          >
            <div className="pt-8">
              {/* ראש העמוד: אורח/מחובר */}
              {!client ? (
                  <motion.div
                      className="px-6 pb-6"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">היי אורח,</h2>
                        <p className="text-sm text-gray-600">בוא תצטרף למשפחה!</p>
                      </div>
                      <Button
                          onClick={() => setShowVerification(true)}
                          className="bg-black text-white rounded-full px-5 py-3 font-semibold shadow-lg text-sm"
                      >
                        התחברות/הרשמה
                      </Button>
                    </div>
                  </motion.div>
              ) : (
                  <motion.div
                      className="px-6 pb-6"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                  >
                    <div className="flex justify-between items-center">
                      <div className="space-y-3">
                        <div>
                          {/* תמיכה גם firstName וגם first_name */}
                          <h2 className="text-lg font-bold text-gray-900">
                            שלום {((client.firstName || client.first_name || '').trim()).toString()},
                          </h2>
                          <p className="text-sm text-gray-600">שמחים לראות אותך</p>
                        </div>

                        {futureRecurringLabel && (
                          <div className="inline-flex max-w-full items-start gap-3 rounded-2xl border border-red-100 bg-gradient-to-l from-red-50 via-white to-red-50 px-4 py-3 shadow-sm">
                            <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.14)]" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900">יש לך תור עתידי קבוע ב־{futureRecurringLabel}</p>
                              <p className="mt-1 text-xs text-gray-600">הוא כבר שמור עבורך במערכת ותוכל לראות אותו גם במסך התורים שלי.</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button
                            onClick={handleBookingClick}
                            className="bg-black text-white rounded-full px-5 py-3 font-semibold shadow-lg text-sm"
                        >
                          קביעת תור
                        </Button>
                        <Button
                            onClick={handleLogout}
                            variant="outline"
                            className="text-xs text-gray-600 border-gray-300 rounded-full px-3 py-1 h-auto"
                        >
                          התנתקות
                        </Button>
                      </div>
                    </div>
                  </motion.div>
              )}

              {/* גלריית וידאו אנכית */}
              <div className="px-4 mt-4 mb-10">
                <VideoGallery />
              </div>

              {/* בלוק תמונה + "קצת עלינו" */}
              <div className="bg-white rounded-3xl mx-4 my-6 shadow-sm overflow-hidden">
                <div className="relative">
                  <img
                      src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/b8717a66a_PHOTO-2025-08-18-13-46-592.jpg"
                      alt="Familia Barbershop Interior"
                      className="w-full h-80 object-cover"
                  />

                  {!showAboutText && (
                      <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="absolute bottom-6 left-1/2 transform -translate-x-1/2"
                      >
                        <Button
                            onClick={() => setShowAboutText(true)}
                            className="bg-black/80 hover:bg-black text-white rounded-full px-8 py-4 font-semibold text-lg shadow-lg backdrop-blur-sm"
                        >
                          קצת על המספרה
                        </Button>
                      </motion.div>
                  )}

                  <AnimatePresence>
                    {showAboutText && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/70 flex flex-col justify-center items-center p-8 text-center"
                        >
                          <motion.div
                              initial={{ y: 30, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ delay: 0.2 }}
                              className="text-white max-w-md"
                          >
                            <h3 className="text-2xl font-bold mb-4 text-white">קצת עלינו</h3>
                            <p className="text-white/90 leading-relaxed mb-6">
                              בפמיליה, כל תספורת היא חוויה. אנו מאמינים שסטייל מתחיל בפרטים הקטנים ומקפידים על שירות אישי, אווירה ביתית וטכניקות מתקדמות. אצלנו כל לקוח מקבל יחס אישי ותספורת מותאמת, כי אתם חלק מהמשפחה.
                            </p>
                            <Button
                                onClick={() => setShowAboutText(false)}
                                variant="outline"
                                className="bg-white/20 border-white/30 text-white hover:bg-white/30 rounded-full px-6 py-3"
                            >
                              <X className="w-4 h-4 mr-2" />
                              סגור
                            </Button>
                          </motion.div>
                        </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* מוצרים */}
              <div className="bg-white rounded-3xl mx-4 my-6 shadow-sm">
                <div className="max-w-6xl mx-auto px-4 py-8">
                  <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
                    המוצרים שלנו
                  </h2>
                  <p className="text-center text-gray-600 mb-8 text-sm">
                    כל מה שהשיער שלך צריך
                  </p>
                  <ProductGallery />
                </div>
              </div>

              {/* טסטמוניאלס */}
              <div className="bg-white rounded-3xl mx-4 my-6 shadow-lg overflow-hidden">
                <div className="max-w-lg mx-auto px-6 py-10">
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 mb-3">מה הלקוחות אומרים</h2>
                    <p className="text-gray-600">חוויות אמיתיות של לקוחותינו</p>
                  </div>

                  <div className="space-y-6">
                    {testimonialsToShow.map((testimonial, index) => (
                        <motion.div
                            key={testimonial.id}
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: index * 0.1 }}
                            className="bg-white rounded-2xl p-6 shadow-md border border-gray-100"
                        >
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 bg-gradient-to-br from-gray-700 to-black rounded-full flex items-center justify-center shadow-lg">
                          <span className="text-lg font-bold text-white">
                            {testimonial.author?.charAt(0) || "מ"}
                          </span>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-1 mb-3">
                                {[...Array(5)].map((_, i) => (
                                    <Star
                                        key={i}
                                        className={`w-4 h-4 ${
                                            i < (testimonial.rating ?? 5)
                                                ? "fill-yellow-400 text-yellow-400"
                                                : "text-gray-300"
                                        }`}
                                    />
                                ))}
                              </div>
                              <p className="text-gray-700 mb-3 leading-relaxed">
                                "{testimonial.text}"
                              </p>
                              <p className="font-semibold text-gray-900 text-sm">
                                — {testimonial.author}
                              </p>
                            </div>
                          </div>
                        </motion.div>
                    ))}
                  </div>

                  {totalTestimonialPages > 1 && (
                      <div className="flex justify-center items-center gap-4 mt-8">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                                setTestimonialPage(Math.max(0, testimonialPage - 1))
                            }
                            disabled={testimonialPage === 0}
                            className="rounded-full bg-white border-gray-200 hover:bg-gray-100"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                        <div className="flex items-center gap-2">
                          {[...Array(totalTestimonialPages)].map((_, i) => (
                              <motion.div
                                  key={i}
                                  animate={{
                                    scale: i === testimonialPage ? 1.5 : 1,
                                    opacity: i === testimonialPage ? 1 : 0.5,
                                  }}
                                  transition={{ duration: 0.3 }}
                                  className={`w-2 h-2 rounded-full ${
                                      i === testimonialPage ? "bg-black" : "bg-gray-300"
                                  }`}
                              />
                          ))}
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                                setTestimonialPage(
                                    Math.min(totalTestimonialPages - 1, testimonialPage + 1)
                                )
                            }
                            disabled={testimonialPage === totalTestimonialPages - 1}
                            className="rounded-full bg-white border-gray-200 hover:bg-gray-100"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                      </div>
                  )}
                </div>
              </div>

              {/* פוטר */}
              <footer className="bg-white rounded-3xl mx-4 mb-2 py-6 shadow-sm">
                <div className="max-w-lg mx-auto px-6 text-center">
                  <h3 className="text-lg font-bold text-gray-800 mb-6">הישארו מעודכנים</h3>
                  <div className="flex justify-center items-center gap-6 sm:gap-7">
                    <a
                        href="https://www.instagram.com/familia.barber8?igsh=d3hpdDFkNTZ5dHRw"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Instagram"
                        className="flex h-12 w-12 items-center justify-center text-gray-500 transition-all duration-200 hover:-translate-y-0.5 hover:text-black"
                    >
                      <Instagram className="h-7 w-7" />
                    </a>
                    <a
                        href="https://wa.me/972523767851"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="WhatsApp"
                        className="flex h-12 w-12 items-center justify-center text-gray-500 transition-all duration-200 hover:-translate-y-0.5 hover:text-black"
                    >
                      <WhatsAppIcon className="h-7 w-7" />
                    </a>
                    <a
                        href="https://www.tiktok.com/@familia_barber?_r=1&_t=ZS-94nhhGm7h9V"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="TikTok"
                        className="flex h-12 w-12 items-center justify-center text-gray-500 transition-all duration-200 hover:-translate-y-0.5 hover:text-black"
                    >
                      <TikTokIcon className="h-7 w-7" />
                    </a>
                  </div>
                </div>
              </footer>

              {/* קרדיט */}
              <div className="text-center py-8 px-4">
                <p className="text-sm text-gray-600">
                  מעוניין במערכת כזו לעסק שלך?
                  <a
                      href="https://wa.me/972537002171?text=היי,%20השתמשתי%20במערכת%20שעשית%20Familia%20barber%20ומאוד%20אהבתי,%20אשמח%20לקבל%20פרטים%20נוספים%20על%20המערכת"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-black hover:underline mr-1"
                  >
                    לחץ כאן
                  </a>
                </p>
                <p className="text-xs text-gray-400 mt-2">v1.0.9</p>
              </div>
            </div>
          </section>
        </div>
      </>
  );
}
