import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Star, ChevronLeft, ChevronRight, Instagram, MessageCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import VideoGallery from "../components/VideoGallery.jsx";
import ProductGallery from "../components/ProductGallery.jsx";
import VerificationModal from "../components/VerificationModal.jsx";
import LoadingScreen from "../components/LoadingScreen.jsx";
import { getStoredAuthToken, clearStoredAuth } from '@/utils/authStorage';

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export default function Home() {
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [testimonials, setTestimonials] = useState([]);
  const [testimonialPage, setTestimonialPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showVerification, setShowVerification] = useState(false);
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState("");
  const [showAboutText, setShowAboutText] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(false);

  useEffect(() => {
    setShowLoadingScreen(true);
    const t = setTimeout(() => setShowLoadingScreen(false), 1500);

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


    loadData();
    return () => clearTimeout(t);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Testimonials דרך REST
      const raw = await fetch(`${API_URL}/testimonials`)
          .then((r) => r.json())
          .catch(() => []);

      const testiFromApi = Array.isArray(raw)
          ? raw.map((t, idx) => ({
            id: t?.id ?? `testimonial-${idx}`,
            author: t?.author || "לקוח מרוצה",
            rating: Number.isFinite(Number(t?.rating)) ? Number(t.rating) : 5,
            text: (t?.text ?? t?.content ?? '').toString(),
            content: (t?.content ?? t?.text ?? '').toString(),
          }))
          : [];

      setTestimonials(testiFromApi);

      // Background videos
      const bg = await fetch(`${API_URL}/background-videos`).then((r) => r.json()).catch(() => []);
      const active = Array.isArray(bg) ? (bg.find((v) => v.isActive || v.is_active) || bg[0]) : null;
      setBackgroundVideoUrl(active?.videoUrl || active?.video_url || "");
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };


  const handleBookingClick = () => {
    if (client && client.phone) navigate("/Book");
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
      sessionStorage.setItem("justLoggedIn", "true");
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

  if (showLoadingScreen) return <LoadingScreen />;

  return (
      <>
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
                    backgroundVideoUrl ||
                    "/videos/backgroundVideo.mp4"
                }
                autoPlay
                muted
                loop
                playsInline
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
                      <div>
                        {/* תמיכה גם firstName וגם first_name */}
                        <h2 className="text-lg font-bold text-gray-900">
                          שלום {((client.firstName || client.first_name || '').trim()).toString()},
                        </h2>
                        <p className="text-sm text-gray-600">שמחים לראות אותך</p>
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
                  <div className="flex justify-center gap-12">
                    <a
                        href="https://www.instagram.com/familia_barbershop_/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-black transition-colors"
                    >
                      <Instagram className="w-8 h-8" />
                    </a>
                    <a
                        href="https://wa.me/972523767851"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      <MessageCircle className="w-8 h-8" />
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
                      className="font-bold text-blue-600 hover:underline mr-1"
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
