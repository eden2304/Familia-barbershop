import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, UserPlus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { setStoredAuthToken } from '@/utils/authStorage';
import { formatRateLimitCountdown, notifyRateLimited, pickRetryAfterSeconds } from '@/lib/rateLimitNotice';

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const BLOCKED_CLIENT_MESSAGE = "כדי לקבוע תור חדש בFamilia, יש ליצור קשר עם חן בWhatsApp או בטלפון";

const notifyAuthChange = () => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event("familia-auth-changed"));
  } catch {
    // ignore
  }
};

/* ---------------- helpers ---------------- */
const normalizePhone = (phone) => {
  if (!phone) return "";
  const cleaned = phone.toString().replace(/\D/g, "");
  if (cleaned.startsWith("972")) return `0${cleaned.substring(3)}`;
  if (cleaned.length === 9 && cleaned.startsWith("5")) return `0${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith("0")) return cleaned;
  return cleaned.startsWith("0") ? cleaned : `0${cleaned}`;
};
const isValidIsraeliMobilePhone = (phone) => /^05\d{8}$/.test(String(phone || "").replace(/\D/g, ""));

async function checkPhoneExists(phoneRaw) {
  const p0 = normalizePhone(phoneRaw);
  const res = await postJson("/auth/check-phone", { phone: p0 });
  // השרת כבר בודק גם 05… וגם 972… אז אין צורך בתחכומים כאן
  return !!res?.exists;
}

async function postJson(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const retryAfterSeconds = res.status === 429
      ? pickRetryAfterSeconds({
          retryAfterHeader: res.headers.get("retry-after"),
          retryAfterPayload: payload?.retryAfterSeconds,
        })
      : 0;
    const msg =
        payload?.message ||
        payload?.error?.code ||
        (typeof payload === "string" ? payload : "") ||
        `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
      err.retryAfterSeconds = retryAfterSeconds;
      notifyRateLimited(retryAfterSeconds);
    }
    throw err;
  }
  return payload;
}


export default function VerificationModal({ onVerify, onCancel }) {
  const [view, setView] = useState("loginPhone");

  // form
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(new Array(4).fill(""));
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [termsFeedbackActive, setTermsFeedbackActive] = useState(false);

  // control
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [resendTimer, setResendTimer] = useState(0);
  const [rateLimitTimer, setRateLimitTimer] = useState(0);
  const [showBlockedPopup, setShowBlockedPopup] = useState(false);
  const inputRefs = useRef([]);
  const termsFeedbackTimeoutRef = useRef(null);

  const showBlockedClientPopup = () => {
    setCode(new Array(4).fill(""));
    setLoading(false);
    setError("");
    setInfoMessage("");
    setRateLimitTimer(0);
    setResendTimer(0);
    setView("loginPhone");
    setShowBlockedPopup(true);
  };

  const resetToHomeAfterOtpExceeded = () => {
    setCode(new Array(4).fill(""));
    setError("בוצעו 3 ניסיונות שגויים. יש להתחיל התחברות מחדש.");
    setView("loginPhone");
    setResendTimer(0);
    if (typeof onCancel === "function") {
      setTimeout(() => onCancel(), 700);
    }
  };

  const isOtpAttemptsExceeded = (err) => {
    const message = err?.payload?.message ?? err?.message;
    return err?.status === 400 && message === "OTP_ATTEMPTS_EXCEEDED";
  };

  const redirectToRegisterWithMessage = () => {
    if (!isValidIsraeliMobilePhone(phone)) {
      setInfoMessage("");
      setError("יש להזין מספר טלפון תקין");
      setView("loginPhone");
      return;
    }

    setError("");
    setInfoMessage("נא להירשם קודם כדי להתחבר למערכת.");
    setView("registerForm");
  };

  // חסימת גלילה בזמן מודאל
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = "unset"; };
  }, []);

  useEffect(() => () => {
    if (termsFeedbackTimeoutRef.current) {
      clearTimeout(termsFeedbackTimeoutRef.current);
    }
  }, []);

  // מיקוד ושעון ספירה מחדש במסך קוד
  useEffect(() => {
    if (view === "loginCode" || view === "registerCode") {
      inputRefs.current[0]?.focus();
      setResendTimer(30);
    }
  }, [view]);

  useEffect(() => {
    if (resendTimer > 0) {
      const t = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [resendTimer]);

  useEffect(() => {
    if (rateLimitTimer <= 0) return;
    const t = setTimeout(() => setRateLimitTimer((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(t);
  }, [rateLimitTimer]);

  // שליחה אוטומטית כשמזינים 4 ספרות
  useEffect(() => {
    if (code.join("").length === 4) {
      if (view === "loginCode") handleLoginCodeSubmit();
      if (view === "registerCode") handleRegisterCodeSubmit();
    }
  }, [code, view]);

  const setRateLimitError = (retryAfterSeconds) => {
    const nextTimer = Math.max(1, Number.parseInt(retryAfterSeconds, 10) || 0);
    setRateLimitTimer(nextTimer);
    setInfoMessage("");
    setError("בוצעו יותר מדי בקשות. למען אבטחת המערכת ניתן לבצע בקשות שוב בעוד:");
  };

  const handleApiError = (e, fallbackMessage) => {
    if (e?.status === 403 && (e?.payload?.message === "CLIENT_BLOCKED" || e?.message === "CLIENT_BLOCKED")) {
      showBlockedClientPopup();
      return true;
    }
    if (e?.status === 429) {
      setRateLimitError(e?.retryAfterSeconds ?? e?.payload?.retryAfterSeconds);
      return true;
    }
    setRateLimitTimer(0);
    if (fallbackMessage) {
      setInfoMessage("");
      setError(fallbackMessage);
    }
    return false;
  };

  // שליחת קוד מחדש (מכבד את ההקשר: התחברות/הרשמה)
  const handleResendCode = async () => {
    if (resendTimer > 0 || loading) return;
    try {
      setError("");
      setInfoMessage("");
      setRateLimitTimer(0);
      const p0 = normalizePhone(phone);
      const p972 = p0.startsWith("0") ? `972${p0.slice(1)}` : p0;

      if (view === "loginCode") {
        try {
          await postJson("/auth/request-code-login", { phone: p0 });
        } catch (e1) {
          if (e1?.status === 409) {
            await postJson("/auth/request-code-login", { phone: p972 });
          } else {
            throw e1;
          }
        }
      } else {
        try {
          await postJson("/auth/request-code", { phone: p0 });
        } catch (e1) {
          if (e1?.status === 409) {
            await postJson("/auth/request-code", { phone: p972 });
          } else {
            throw e1;
          }
        }
      }
      setResendTimer(30);
    } catch (e) {
      if (e?.status === 409) {
        redirectToRegisterWithMessage();
      } else {
        handleApiError(e, "שגיאה בשליחת קוד. נסה שוב.");
      }
    }
  };


  // --- LOGIN FLOW ---
  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    if (!isValidIsraeliMobilePhone(phone)) {
      setError("יש להזין מספר טלפון תקין");
      return;
    }
    setLoading(true);
    setError("");
    setInfoMessage("");
    setRateLimitTimer(0);

    const p0 = normalizePhone(phone);                           // 05XXXXXXXX
    const p972 = p0.startsWith("0") ? `972${p0.slice(1)}` : p0; // 9725XXXXXXXX

    try {
      await postJson("/auth/request-code-login", { phone: p0 });
      setView("loginCode");
    } catch (err1) {
      // לא רשום? ננסה עם הווריאנט השני
      if (err1?.status === 409) {
        try {
          await postJson("/auth/request-code-login", { phone: p972 });
          setView("loginCode");
        } catch (err2) {
          if (err2?.status === 409) {
            redirectToRegisterWithMessage();
          } else {
            handleApiError(err2, "שגיאה בבקשת קוד. נסה שוב.");
          }
        }
      } else {
        handleApiError(err1, "שגיאה בבקשת קוד. נסה שוב.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoginCodeSubmit = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    setInfoMessage("");
    setRateLimitTimer(0);

    const pin = code.join("");
    const p0 = normalizePhone(phone);                           // 05XXXXXXXX
    const p972 = p0.startsWith("0") ? `972${p0.slice(1)}` : p0; // 9725XXXXXXXX

    async function verifyOnce(phoneToSend) {
      const res = await postJson("/auth/verify-code", { phone: phoneToSend, code: pin });
      const c = res?.client || res?.user;
      if (!res?.ok || !c) throw new Error("UNREGISTERED_CLIENT");
      const memberFlag = Boolean(c.isMember ?? c.is_member ?? false);
      const adminFlag = Boolean(res?.roles?.includes('admin') || c.isAdmin || c.is_admin);
      const payload = {
        ...c,
        phone: (c.phone || phoneToSend || "").toString(),
        firstName: c.firstName || c.first_name || "",
        lastName:  c.lastName  || c.last_name  || "",
        isAdmin: adminFlag,
        is_admin: adminFlag,
        isMember: memberFlag,
        is_member: memberFlag,
        roles: Array.isArray(res?.roles) ? res.roles : undefined,
      };

      localStorage.setItem("familiaClient", JSON.stringify(payload));
      if (res.token) setStoredAuthToken(res.token);
      notifyAuthChange();
      onVerify(payload);
    }

    try {
      await verifyOnce(p0);
    } catch (e1) {
      if (e1?.status === 409 || e1?.message === "UNREGISTERED_CLIENT") {
        try {
          await verifyOnce(p972);
        } catch (e2) {
          if (e2?.status === 409 || e2?.message === "UNREGISTERED_CLIENT") {
            redirectToRegisterWithMessage();
          } else if (isOtpAttemptsExceeded(e2)) {
            resetToHomeAfterOtpExceeded();
          } else if (e2?.status === 400) {
            setError("קוד לא תקין.");
          } else {
            handleApiError(e2, "שגיאה באימות. נסה שוב.");
          }
        }
      } else if (isOtpAttemptsExceeded(e1)) {
        resetToHomeAfterOtpExceeded();
      } else if (e1?.status === 400) {
        setError("קוד לא תקין.");
      } else {
        handleApiError(e1, "שגיאה באימות. נסה שוב.");
      }
    } finally {
      setLoading(false);
    }
  };

  // --- REGISTER FLOW ---
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!firstName || !lastName || !phone) {
      setError("נא למלא את כל השדות.");
      return;
    }
    if (!isValidIsraeliMobilePhone(phone)) {
      setError("יש להזין מספר טלפון תקין");
      return;
    }
    if (!termsAccepted) {
      triggerTermsFeedback();
      setError("יש לאשר את התקנון כדי להמשיך.");
      return;
    }

    setLoading(true);
    setError("");
    setInfoMessage("");
    setRateLimitTimer(0);

    try {
      const normalizedPhone = normalizePhone(phone);

      // ✅ בדיקה מוקדמת – אם רשום עוצרים כאן (לא עוברים למסך קוד)
      const exists = await checkPhoneExists(normalizedPhone);
      if (exists) {
        setError("מספר זה כבר רשום. עבור למסך התחברות.");
        setView("loginPhone");
        return; // חשוב: לא ממשיכים לבקשת קוד
      }

      // ממשיכים רק אם המספר לא קיים
      await postJson("/auth/request-code", { phone: normalizedPhone });
      setView("registerCode");

    } catch (e) {
      console.error("request-code error (register):", e);
      // אם מסיבה כלשהי השרת כן החזיר 409 כאן – עדיין נעצור
      if (e?.status === 409 && (e?.message === "ALREADY_REGISTERED" || e?.payload?.message === "ALREADY_REGISTERED")) {
        setError("מספר זה כבר רשום. עבור למסך התחברות.");
        setView("loginPhone");
      } else {
        handleApiError(e, "שגיאה בבקשת קוד. נסה שוב.");
      }
    } finally {
      setLoading(false);
    }
  };



  const handleRegisterCodeSubmit = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    setInfoMessage("");
    setRateLimitTimer(0);
    try {
      const normalizedPhone = normalizePhone(phone);
      // ✅ רישום אמיתי בשרת
      const res = await postJson("/auth/register", {
        phone: normalizedPhone,
        code: code.join(""),
        firstName,
        lastName,
      });
      if (res?.ok) {
        const normalizedPhone = normalizePhone(phone);
        const c = res.client || res.user || {};
        const fn = c.firstName || c.first_name || firstName || "";
        const ln = c.lastName  || c.last_name  || lastName  || "";
        const memberFlag = Boolean(c.isMember ?? c.is_member ?? false);
        const adminFlag = Boolean(res?.roles?.includes('admin') || c.isAdmin || c.is_admin);
        const payload = {
          ...c,
          phone: (c.phone || normalizedPhone || "").toString(),
          firstName: fn,
          lastName:  ln,
          isAdmin: adminFlag,
          is_admin: adminFlag,
          isMember: memberFlag,
          is_member: memberFlag,
          roles: Array.isArray(res?.roles) ? res.roles : undefined,
        };
        localStorage.setItem("familiaClient", JSON.stringify(payload));
        if (res.token) setStoredAuthToken(res.token);
        notifyAuthChange();
        onVerify(payload);
      } else {
        setError("שגיאה ביצירת המשתמש. נסה שוב.");
      }

    } catch (e) {
      console.error("verify-code register error:", e);
      if (e?.status === 409 && (e?.message === "ALREADY_REGISTERED" || e?.payload?.message === "ALREADY_REGISTERED")) {
        setError("מספר זה כבר רשום. עבור למסך התחברות.");
        setView("loginPhone");
      } else if (e?.status === 400 && (e?.message === "NAME_REQUIRED" || e?.payload?.message === "NAME_REQUIRED")) {
        setError("חובה להזין שם פרטי ושם משפחה.");
      } else if (isOtpAttemptsExceeded(e)) {
        resetToHomeAfterOtpExceeded();
      } else if (e?.status === 400) {
        setError("קוד לא תקין.");
      } else {
        handleApiError(e, "שגיאה ביצירת המשתמש. נסה שוב.");
      }
    } finally {
      setLoading(false);
    }
  };

  // קלטי קוד
  const handleCodeChange = (e, index) => {
    const { value } = e.target;
    if (/^[0-9]$/.test(value) || value === "") {
      const newCode = [...code];
      newCode[index] = value;
      setCode(newCode);
      if (value !== "" && index < 3) inputRefs.current[index + 1]?.focus();
    }
  };
  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const triggerTermsFeedback = () => {
    if (termsFeedbackTimeoutRef.current) {
      clearTimeout(termsFeedbackTimeoutRef.current);
    }
    setTermsFeedbackActive(false);
    requestAnimationFrame(() => {
      setTermsFeedbackActive(true);
      termsFeedbackTimeoutRef.current = setTimeout(() => {
        setTermsFeedbackActive(false);
      }, 700);
    });
  };

  const handleTermsAcceptedChange = (checked) => {
    const accepted = checked === true;
    setTermsAccepted(accepted);
    if (accepted) {
      setTermsFeedbackActive(false);
      if (termsFeedbackTimeoutRef.current) {
        clearTimeout(termsFeedbackTimeoutRef.current);
      }
    }
  };

  const handleTermsOpen = () => {
    setTermsFeedbackActive(false);
    setShowTerms(true);
  };

  const handleUnderstoodClick = () => {
    setTermsAccepted(true);
    setTermsFeedbackActive(false);
    setShowTerms(false);
  };

  // === UI ===
  const renderContent = () => {
    switch (view) {
      case "loginPhone":
        return (
            <form onSubmit={handlePhoneSubmit} className="text-center">
              <h3 className="text-xl font-bold text-gray-900 mb-2">התחברות</h3>
              <p className="text-gray-600 mb-6">הזן את מספר הטלפון שלך</p>
              <Input
                  type="tel"
                  placeholder="05X-XXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  className="text-center bg-gray-50 border-gray-200 rounded-xl h-12 text-lg"
              />
              <Button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 bg-black text-white hover:bg-gray-800 rounded-full py-3 font-medium text-lg"
              >
                {loading ? "בודק..." : "קבלת קוד"}
              </Button>
              <Button
                  variant="link"
                  onClick={() => {
                    setError("");
                    setInfoMessage("");
                    setView("registerForm");
                  }}
                  className="mt-4 text-gray-600"
              >
                לקוח חדש? לחץ להרשמה
              </Button>
            </form>
        );

      case "loginCode":
      case "registerCode":
        return (
            <div className="text-center">
              <Shield className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">אימות קוד</h3>
              <p className="text-gray-600 text-sm mb-6">
                הזן את 4 הספרות שנשלחו למספר{" "}
                <span className="font-bold">{phone}</span>
              </p>
              <div className="flex justify-center gap-2 my-6" dir="ltr">
                {code.map((digit, index) => (
                    <Input
                        key={index}
                        ref={(el) => (inputRefs.current[index] = el)}
                        type="tel"
                        maxLength="1"
                        value={digit}
                        onChange={(e) => handleCodeChange(e, index)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        className="w-12 h-14 text-center text-2xl font-bold rounded-xl bg-gray-100 border-2 border-gray-200 focus:border-black focus:ring-black"
                    />
                ))}
              </div>
              <div className="text-sm text-gray-500 mb-6">
                לא קיבלת קוד?{" "}
                <Button
                    type="button"
                    variant="link"
                    onClick={handleResendCode}
                    disabled={resendTimer > 0}
                    className="p-0 h-auto disabled:text-gray-400 disabled:no-underline"
                >
                  שלח שוב {resendTimer > 0 ? `(${resendTimer})` : ""}
                </Button>
              </div>
              <Button
                  onClick={
                    view === "loginCode"
                        ? handleLoginCodeSubmit
                        : handleRegisterCodeSubmit
                  }
                  disabled={loading || code.join("").length < 4}
                  className="w-full bg-black text-white hover:bg-gray-800 rounded-full py-3 font-medium text-lg"
              >
                {loading ? "מאמת..." : "אמת וסיים"}
              </Button>
            </div>
        );

      case "registerForm":
        return (
            <form onSubmit={handleRegisterSubmit} className="text-center">
              <UserPlus className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-4">הרשמה</h3>
              <div className="space-y-4 text-right">
                <Input
                    placeholder="שם פרטי"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="text-right"
                />
                <Input
                    placeholder="שם משפחה"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="text-right"
                />
                <Input
                    type="tel"
                    placeholder="05X-XXXXXXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    className="text-right"
                />
                <motion.div
                  className="flex items-center space-x-2 space-x-reverse origin-center"
                  animate={termsFeedbackActive ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
                  transition={{ duration: 0.45, ease: "easeInOut" }}
                >
                  <Checkbox
                      id="terms"
                      checked={termsAccepted}
                      onCheckedChange={handleTermsAcceptedChange}
                      className={termsFeedbackActive ? "border-red-500 text-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500" : ""}
                  />
                  <label
                    htmlFor="terms"
                    className={`text-sm transition-colors duration-200 ${termsFeedbackActive ? "text-red-500" : "text-gray-700"}`}
                  >
                    אני מאשר שקראתי את{" "}
                    <Button
                        variant="link"
                        type="button"
                        onClick={handleTermsOpen}
                        className={`p-0 h-auto font-semibold transition-colors duration-200 ${termsFeedbackActive ? "text-red-500 hover:text-red-600" : "text-black hover:text-gray-700"}`}
                    >
                      התקנון
                    </Button>
                  </label>
                </motion.div>
              </div>
              <Button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-6 bg-black text-white hover:bg-gray-800 rounded-full py-3 font-medium text-lg"
              >
                {loading ? "בודק..." : "המשך"}
              </Button>
              <Button
                  variant="link"
                  onClick={() => {
                    setError("");
                    setInfoMessage("");
                    setView("loginPhone");
                  }}
                  className="mt-4 text-gray-600"
              >
                לקוח קיים? לחץ להתחברות
              </Button>
            </form>
        );

      default:
        return null;
    }
  };

  return (
      <>
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
        >
          <motion.div
              initial={{ scale: 0.9, y: 50, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 50, opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm bg-white rounded-3xl px-6 pb-6 pt-14"
          >
            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCancel}
                className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                aria-label="סגירת חלון ההתחברות"
            >
              <X className="h-5 w-5" />
            </Button>
            <AnimatePresence mode="wait">
              <motion.div
                  key={view}
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ duration: 0.2 }}
              >
                {infoMessage && (
                    <Alert className="mb-4 border-blue-200 bg-blue-50 text-center">
                      <AlertDescription className="text-blue-700">
                        {infoMessage}
                      </AlertDescription>
                    </Alert>
                )}
                {error && (
                    <Alert className="mb-4 border-red-200 bg-red-50 text-center">
                      <AlertDescription className="text-red-700">
                        {error}
                        {rateLimitTimer > 0 && (
                          <div className="mt-1 font-semibold" dir="ltr">
                            {formatRateLimitCountdown(rateLimitTimer)}
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                )}
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>

        <AnimatePresence>
          {showBlockedPopup && (
              <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
              >
                <motion.div
                    initial={{ scale: 0.92, y: 24, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    exit={{ scale: 0.96, y: 12, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={(event) => event.stopPropagation()}
                    className="w-full max-w-sm rounded-[28px] bg-zinc-900 px-6 py-7 text-center text-white shadow-2xl"
                >
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15">
                    <Shield className="h-7 w-7 text-red-300" />
                  </div>
                  <h3 className="mb-2 text-xl font-bold">לא ניתן להתחבר</h3>
                  <p className="mb-6 text-sm leading-7 text-zinc-200">
                    {BLOCKED_CLIENT_MESSAGE}
                  </p>
                  <Button
                      type="button"
                      onClick={() => setShowBlockedPopup(false)}
                      className="w-full rounded-full bg-white text-zinc-900 hover:bg-zinc-100"
                  >
                    אישור
                  </Button>
                </motion.div>
              </motion.div>
          )}
        </AnimatePresence>

        {/* תקנון */}
        {showTerms && (
            <div
                className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTerms(false);
                }}
            >
              <div
                  className="bg-white rounded-2xl p-6 max-w-md max-h-[80vh] overflow-y-auto m-4"
                  onClick={(e) => e.stopPropagation()}
              >
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-gray-900">תקנון שימוש</h3>
                </div>
                <div className="text-right space-y-4 text-sm">
                  <div>
                    <h4 className="font-bold">קביעת תורים</h4>
                    <ul className="list-disc pr-5 space-y-1 mt-2">
                      <li>ניתן ורצוי לקבוע תורים מראש דרך האפליקציה.</li>
                      <li>ביטול תור יתבצע עד 24 שעות לפני מועד התור.</li>
                      <li>יש להגיע אל המספרה לפחות 10 דקות לפני שעת התור שנקבעה.</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold">פרטיות ואבטחת מידע</h4>
                    <ul className="list-disc pr-5 space-y-1 mt-2">
                      <li>כל המידע הנמסר באפליקציה נשמר במערכות מאובטחות.</li>
                      <li>המידע לא יועבר לצד שלישי ללא הסכמה מפורשת של המשתמש.</li>
                    </ul>
                  </div>
                </div>
                <div className="mt-6">
                  <Button
                      onClick={handleUnderstoodClick}
                      className="w-full bg-black text-white rounded-full"
                  >
                    הבנתי
                  </Button>
                </div>
              </div>
            </div>
        )}
      </>
  );
}
