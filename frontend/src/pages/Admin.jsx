import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Service } from "@/api/entities";
import { Appointment } from "@/api/entities";
import { BusinessHours } from "@/api/entities";
import { Testimonial } from "@/api/entities";
import { GalleryImage } from "@/api/entities";
import { WaitingList } from "@/api/entities";
import { Client } from "@/api/entities";
import { BackgroundVideo } from "@/api/entities";
import { Product } from "@/api/entities";
import { Setting } from "@/api/entities";
import { UploadFile } from "@/api/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectValue, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/use-toast";
import {
  Calendar,
  Clock,
  User,
  Phone,
  Edit,
  Trash2,
  Plus,
  Eye,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Settings,
  Video,
  MessageSquare,
  Star,
  Lock,
  Upload,
  Users,
  Package,
  LogOut,
  Menu,
  X,
  BarChart3,
  Ban,
  Send,
  MoreVertical,
  Replace,
  Repeat,
  GripVertical,
  Crown,
  FileSpreadsheet,
  Bell,
  Loader2,
  LayoutGrid,
  List,
} from "lucide-react";
import { format, addDays, startOfWeek, isSameDay, startOfDay, subDays, isAfter, setHours, setMinutes, isBefore, isSameHour, isSameMinute, isSameSecond, addMinutes, differenceInDays } from "date-fns";
import { he } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import ProductForm from "../components/ProductForm.jsx";
import AdminAppointmentForm from "../components/AdminAppointmentForm.jsx";
import AppointmentActionsModal from "../components/AppointmentActionsModal.jsx";
import BlockAppointmentsModal from "../components/BlockAppointmentsModal.jsx";
import WaitingListActionModal from "../components/WaitingListActionModal.jsx";
import { useSidebar } from "../components/SidebarContext.jsx"; // Import the context hook
import { fullName, serviceName, isPast, phone } from '@/lib/apt-utils';
import { Admin as AdminApi } from "@/api/entities";
import api, { API_ROOT } from "@/api/base44Client";
import { DEFAULT_BOOKING_RULES, normalizeBookingRules, sanitizeBookingRulesForSave, clampAdvanceDays } from "@/lib/booking-rules";
import { getStoredAuthToken, clearStoredAuth, setStoredAuthToken } from '../utils/authStorage';

const resolveMediaUrl = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(API_ROOT || "").replace(/\/+$/, "");
  if (value.startsWith("/")) return `${base}${value}`;
  return `${base}/${value}`;
};

const loadXlsxLibrary = (() => {
  let loaderPromise;
  return async () => {
    if (globalThis?.XLSX) return globalThis.XLSX;
    if (!loaderPromise) {
      loaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        script.async = true;
        script.onload = () => resolve(globalThis.XLSX);
        script.onerror = () => reject(new Error("Failed to load XLSX library"));
        document.body.appendChild(script);
      });
    }
    return loaderPromise;
  };
})();


const navItems = [
  { id: 'appointments', label: 'תורים', icon: Calendar },
  //{ id: 'statistics', label: 'סטטיסטיקות', icon: BarChart3 },
  { id: 'clients', label: 'לקוחות', icon: Users },
  { id: 'updates', label: 'עדכונים', icon: Bell },
  { id: 'business-hours', label: 'שעות פעילות', icon: Clock },
  { id: 'member-settings', label: 'חברי מועדון', icon: Crown },
  { id: 'services', label: 'שירותים', icon: Settings },
  { id: 'products', label: 'מוצרים', icon: Package },
  { id: 'stories', label: 'סטוריז', icon: Video },
  { id: 'testimonials', label: 'תגובות', icon: MessageSquare },
  { id: 'background', label: 'סרטון רקע', icon: Video },
];

const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MEMBER_SLOT_WEEKDAYS = WEEKDAY_LABELS.slice(0, 6);

const DEFAULT_MEMBER_DAY_HOURS = [
  { weekday: 0, open: '10:00', close: '19:00', slotMinutes: 30 },
  { weekday: 1, open: '10:00', close: '19:00', slotMinutes: 30 },
  { weekday: 2, open: '10:00', close: '19:00', slotMinutes: 30 },
  { weekday: 3, open: '10:00', close: '19:00', slotMinutes: 30 },
  { weekday: 4, open: '10:00', close: '19:00', slotMinutes: 30 },
  { weekday: 5, open: '08:00', close: '15:00', slotMinutes: 30 },
  { weekday: 6, open: '08:00', close: '14:00', slotMinutes: 30 },
];

const RECURRING_CANCEL_INITIAL = {
  isOpen: false,
  schedule: null,
  scheduleId: null,
  clientName: '',
  scheduleLabel: '',
  intervalLabel: '',
  serviceLabel: '',
};

const APPOINTMENT_STATUS_STYLES = {
  booked: { label: 'תור עתידי', className: 'bg-blue-100 text-blue-700' },
  completed: { label: 'הושלם', className: 'bg-emerald-100 text-emerald-700' },
  canceled: { label: 'בוטל', className: 'bg-gray-200 text-gray-600' },
};

const toMinutes = (time) => {
  if (!time && time !== 0) return null;
  const [hh, mm] = String(time).split(':');
  const hours = Number(hh);
  const minutes = Number(mm);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const toTimeString = (minutes) => {
  if (!Number.isFinite(minutes)) return null;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const expandWindowsToSlots = (windows, stepMinutes) => {
  if (!Array.isArray(windows) || !stepMinutes) return [];
  const slots = new Set();
  windows.forEach((win) => {
    const start = toMinutes(win?.start);
    const end = toMinutes(win?.end);
    if (start == null || end == null || end <= start) return;
    for (let t = start; t + stepMinutes <= end; t += stepMinutes) {
      slots.add(toTimeString(t));
    }
  });
  return Array.from(slots).sort((a, b) => toMinutes(a) - toMinutes(b));
};

const slotsToWindows = (slots, stepMinutes) => {
  if (!Array.isArray(slots) || slots.length === 0 || !stepMinutes) return [];
  const minutes = slots
    .map(toMinutes)
    .filter((val) => val != null)
    .sort((a, b) => a - b);
  if (minutes.length === 0) return [];
  const windows = [];
  let rangeStart = minutes[0];
  let prev = minutes[0];
  for (let i = 1; i < minutes.length; i += 1) {
    const current = minutes[i];
    if (current === prev + stepMinutes) {
      prev = current;
      continue;
    }
    windows.push({ start: toTimeString(rangeStart), end: toTimeString(prev + stepMinutes) });
    rangeStart = current;
    prev = current;
  }
  windows.push({ start: toTimeString(rangeStart), end: toTimeString(prev + stepMinutes) });
  return windows;
};

const buildSlotsFromRanges = (ranges, stepMinutes) => {
  if (!Array.isArray(ranges) || !stepMinutes) return [];
  const slots = new Set();
  ranges.forEach((range) => {
    const start = toMinutes(range?.start);
    const end = toMinutes(range?.end);
    if (start == null || end == null || end <= start) return;
    for (let t = start; t + stepMinutes <= end; t += stepMinutes) {
      slots.add(toTimeString(t));
    }
  });
  return Array.from(slots).sort((a, b) => toMinutes(a) - toMinutes(b));
};

const normalizeBusinessHourRow = (row) => {
  if (!row) return null;
  const weekday = Number(row.weekday ?? row.day_of_week ?? row.day ?? row.dayOfWeek);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const open = row.open ?? row.opens_at ?? row.open_time ?? row.start ?? row.start_time;
  const close = row.close ?? row.closes_at ?? row.close_time ?? row.end ?? row.end_time;
  const slot = Number(
    row.slot ??
    row.slotMinutes ??
    row.slot_minutes ??
    row.slotIntervalMinutes ??
    row.interval ??
    row.interval_minutes ??
    row.intervalMinutes ??
    30
  ) || 30;
  const isOpen = row.isOpen ?? row.is_open ?? Boolean(open && close);
  return { weekday, open, close, slotMinutes: slot, isOpen };
};

const normalizePhone = (phone) => {
  if (!phone) return "";
  const cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.startsWith('972')) {
    return `0${cleaned.substring(3)}`;
  } else if (cleaned.length === 9 && cleaned.startsWith('5')) {
    return `0${cleaned}`;
  } else if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return cleaned;
  }
  return cleaned.startsWith('0') ? cleaned : `0${cleaned}`;
};


export default function Admin() { // Removed props
  const { sidebarOpen, setSidebarOpen } = useSidebar(); // Consume context
  const navigate = useNavigate();
  // --- Admin access & auth ---
  const [canAccessAdmin, setCanAccessAdmin] = useState(false); // נקבע ע"י ה-guard מה-localStorage
  const [isCodeVerified, setIsCodeVerified] = useState(false); // נהיה true רק אחרי אימות קוד
  const [isAuthenticated, setIsAuthenticated] = useState(false); // משמש לפתיחת ה-UI אחרי הקוד
  const [adminCode, setAdminCode] = useState("");               // קלט הקוד
  const [authError, setAuthError] = useState("");               // הודעת שגיאה במסך הקוד



  const [appointments, setAppointments] = useState([]);
  const [adminUpdates, setAdminUpdates] = useState([]);
  const [isRefreshingUpdates, setIsRefreshingUpdates] = useState(false);
  const [isClearingUpdates, setIsClearingUpdates] = useState(false);
  const [updatesPullDistance, setUpdatesPullDistance] = useState(0);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [galleryImages, setGalleryImages] = useState([]);
  const [businessHours, setBusinessHours] = useState([]);
  const [businessHoursDraft, setBusinessHoursDraft] = useState(() => []);
  const [businessHoursDirty, setBusinessHoursDirty] = useState(false);
  const [businessHoursSaving, setBusinessHoursSaving] = useState(false);
  const [businessHoursFeedback, setBusinessHoursFeedback] = useState(null);
  const [allClients, setAllClients] = useState([]);
  const [backgroundVideos, setBackgroundVideos] = useState([]);
  const [products, setProducts] = useState([]);
  const [waitingList, setWaitingList] = useState([]);
  const [expandedWaitingTimes, setExpandedWaitingTimes] = useState(() => new Set());
  const [memberSettings, setMemberSettings] = useState(() => ({ ...DEFAULT_BOOKING_RULES }));
  const [memberSettingsDirty, setMemberSettingsDirty] = useState(false);
  const [memberSettingsSaving, setMemberSettingsSaving] = useState(false);
  const [memberSettingsFeedback, setMemberSettingsFeedback] = useState(null);
  const [cancelingRecurringId, setCancelingRecurringId] = useState(null);
  const [recurringCancelModal, setRecurringCancelModal] = useState({ ...RECURRING_CANCEL_INITIAL });
  const [clientDetailsModal, setClientDetailsModal] = useState({ isOpen: false, client: null });
  const [clientDetailsAppointmentsAll, setClientDetailsAppointmentsAll] = useState([]);
  const [clientDetailsAppointmentsLoading, setClientDetailsAppointmentsLoading] = useState(false);
  const [clientDetailsAppointmentsError, setClientDetailsAppointmentsError] = useState(null);
  const [cancelingAppointmentId, setCancelingAppointmentId] = useState(null);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [selectedWaitingEntry, setSelectedWaitingEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("appointments");

  const [showQuickActionsModal, setShowQuickActionsModal] = useState(false);
  const [showImportClientsModal, setShowImportClientsModal] = useState(false);
  const [importClientsFile, setImportClientsFile] = useState(null);
  const [importClientsPreview, setImportClientsPreview] = useState([]);
  const [importClientsFeedback, setImportClientsFeedback] = useState(null);
  const [importClientsLoading, setImportClientsLoading] = useState(false);
  const isPhoneLike = (value) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length >= 7;
  };

  const buildClientName = (client) => {
    if (!client) return "";
    const first = client.first_name ?? client.firstName ?? '';
    const last = client.last_name ?? client.lastName ?? '';
    const full = `${first} ${last}`.trim();
    return full || client.name?.trim() || '';
  };

  const findClientForAppointment = (apt) => {
    const aptClientId = apt?.client_id ?? apt?.clientId ?? apt?.client?.id;
    if (aptClientId) {
      const byId = (allClients || []).find((client) => String(client.id) === String(aptClientId));
      if (byId) return byId;
    }
    const aptPhone = normalizePhone(apt?.client_phone ?? apt?.phone ?? apt?.client?.phone ?? "");
    if (!aptPhone) return null;
    return (allClients || []).find((client) => normalizePhone(client.phone ?? client.client_phone ?? "") === aptPhone) || null;
  };

  const getAppointmentDisplayInfo = (apt) => {
    const matchedClient = findClientForAppointment(apt);
    const appointmentFirst = apt?.client?.firstName ?? apt?.client_first_name ?? apt?.first_name ?? '';
    const appointmentLast = apt?.client?.lastName ?? apt?.client_last_name ?? apt?.last_name ?? '';
    const appointmentName = `${appointmentFirst} ${appointmentLast}`.trim();
    const rawClientName = String(apt?.client_name ?? apt?.clientName ?? '').trim();
    const safeRawName = rawClientName && !isPhoneLike(rawClientName) ? rawClientName : '';
    const clientName = buildClientName(matchedClient);
    const name = appointmentName || safeRawName || clientName || 'לקוח';
    const clientPhone = matchedClient?.phone ?? matchedClient?.client_phone ?? apt?.client_phone ?? apt?.phone ?? apt?.client?.phone ?? '';

    const normalizedClient = matchedClient
        ? {
          ...matchedClient,
          firstName: matchedClient.firstName ?? matchedClient.first_name ?? matchedClient.name?.split(' ')[0],
          lastName: matchedClient.lastName ?? matchedClient.last_name ?? matchedClient.name?.split(' ').slice(1).join(' '),
        }
        : null;

    return { name, phone: clientPhone, client: normalizedClient };
  };

  const [showAddAppointmentForm, setShowAddAppointmentForm] = useState(false);
  const [showBlockingForm, setShowBlockingForm] = useState(false);

  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [recurringSuccessModal, setRecurringSuccessModal] = useState({ isOpen: false, message: '', skippedDates: [] });
  const [recurringConflictModal, setRecurringConflictModal] = useState({ isOpen: false, message: '', conflicts: [], hasMore: false });


  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showTestimonialForm, setShowTestimonialForm] = useState(false);
  const [showGalleryForm, setShowGalleryForm] = useState(false);
  const [showBackgroundVideoForm, setShowBackgroundVideoForm] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [editingTestimonial, setEditingTestimonial] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showClientForm, setShowClientForm] = useState(null);
  const [editingClient, setEditingClient] = useState(null);
  const [clientSearchTerm, setClientSearchTerm] = useState("");
  const [showMembersOnlyClients, setShowMembersOnlyClients] = useState(false);

  const [showWaitingListView, setShowWaitingListView] = useState(false);
  const [appointmentsViewMode, setAppointmentsViewMode] = useState('list');
  const [weeklyAppointmentsData, setWeeklyAppointmentsData] = useState([]);
  const [draggedAppointmentId, setDraggedAppointmentId] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [pendingCalendarMove, setPendingCalendarMove] = useState(null);
  const [isSavingCalendarMove, setIsSavingCalendarMove] = useState(false);

  // ====== חסימות זמנים (Admin.blocks) ======
  const [blocks, setBlocks] = useState([]);

// תאריך היום הנבחר כמחרוזת YYYY-MM-DD
  const selectedDateStr = useMemo(
      () => format(startOfDay(selectedDate), "yyyy-MM-dd"),
      [selectedDate]
  );

  useEffect(() => {
    const t = getStoredAuthToken();
    if (t) {
      setIsCodeVerified(true);
      setIsAuthenticated(true);
      loadData();
    }
  }, []);


  // guard: מוודא שיש לקוח ובעל הרשאת אדמין, אחרת מחזיר לדף הבית
  useEffect(() => {
    try {
      const raw = localStorage.getItem("familiaClient");
      const token = getStoredAuthToken();
      const client = raw ? JSON.parse(raw) : null;
      const adminFlag = Boolean(client?.isAdmin || client?.is_admin || client?.roles?.includes('admin'));
      if (!client || !token || !adminFlag) {
        localStorage.removeItem("familiaClient");
        if (!token) clearStoredAuth();
        navigate(createPageUrl("Home"));
        return;
      }
      setCanAccessAdmin(true);
    } catch {
      localStorage.removeItem("familiaClient");
      clearStoredAuth();
      navigate(createPageUrl("Home"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (!Array.isArray(businessHours) || businessHoursDirty) return;
    const rows = Array.from({ length: 7 }, (_, day) => {
      const existing = (businessHours || []).find((row) => Number(row?.weekday) === day);
      const normalized = normalizeBusinessHourRow(existing);
      const fallback = DEFAULT_MEMBER_DAY_HOURS.find((h) => Number(h.weekday) === day);
      const defaultOpen = fallback?.open ?? "10:00";
      const defaultClose = fallback?.close ?? "18:00";
      const slotMinutes = Number(
          normalized?.slotMinutes ??
          normalized?.slot ??
          fallback?.slotMinutes ??
          fallback?.slot ??
          30
      ) || 30;
      const open = normalized?.open ?? defaultOpen;
      const close = normalized?.close ?? defaultClose;
      const isOpen = normalized?.isOpen ?? (Boolean(open && close) && open !== close);
      return {
        weekday: day,
        open,
        close,
        slotIntervalMinutes: slotMinutes,
        isOpen,
      };
    });
    setBusinessHoursDraft(rows);
  }, [businessHours, businessHoursDirty]);

  async function handleAdminCodeSubmit(e) {
    e?.preventDefault?.();
    setAuthError("");

    let res;
    try {
      res = await api.post('/admin/verify-code', { code: adminCode });
    } catch (err) {
      setAuthError("קוד אדמין שגוי.");
      return;
    }

    if (!res?.accessToken) {
      setAuthError("קוד אדמין שגוי.");
      return;
    }

    // ✅ התחברות הצליחה
    setStoredAuthToken(res.accessToken);
    setIsCodeVerified(true);
    setIsAuthenticated(true);
    console.log('admin auth set true');

    // ✅ עכשיו טוענים דאטה, ואם זה נכשל — לא מציגים "קוד שגוי"
    try {
      await loadData();
      console.log('loadData done');
    } catch (err) {
      console.error("Admin loadData failed:", err);
      setAuthError("התחברת, אבל טעינת נתונים נכשלה.");
    }
  }


  function formatDateTime(dt) {
    try { return format(new Date(dt), "EEE dd/MM HH:mm", { locale: he }); }
    catch { return ""; }
  }

  const reloadBlocks = async () => {
    try {
      const list = await AdminApi.blocks.list(selectedDateStr);
      setBlocks(Array.isArray(list) ? list : []);
    } catch {
      setBlocks([]);
    }
  };

  const handleRemoveBlock = async (id) => {
    if (!id) return;
    if (!confirm("לבטל את החסימה הזו?")) return;
    try {
      await AdminApi.blocks.remove(id);
      await reloadBlocks();
      await loadData(); // נרענן גם תורים/זמינות
    } catch (e) {
      console.error(e);
      alert("נכשלה מחיקת החסימה");
    }
  };

// טען/ני חסימות כשמשתנה היום או כשהמודאל של חסימה נסגר/נפתח
  useEffect(() => {
    reloadBlocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateStr, showBlockingForm]);


// יומיים אחורה מימין ל"היום", ואז הימים קדימה
  const DAYS_FORWARD = 14;

  const daysForPicker = useMemo(() => {
    const today = startOfDay(new Date());

    // סדר כך שהקרוב להיום מופיע ראשון (ימין קרוב להיום), ואז שלשום
    const pastAsc = [subDays(today, 2), subDays(today, 1)];

    const futureAsc = Array.from({ length: DAYS_FORWARD }, (_, i) =>
        addDays(today, i + 1)
    );

    // חשוב: אתמול/שלשום לפני today => יש מה לגלול ימינה (RTL) לראות עבר
    return [...pastAsc, today, ...futureAsc];
  }, []);



// שני פסי ימים (אם יש גם ברשימת המתנה וגם במסך הראשי)
  const dayStripRef1 = React.useRef(null);
  const dayStripRef2 = React.useRef(null);

// מרכזים את היום הנבחר בתוך הפס בכל שינוי/טעינה
  const didInitialScrollRef = React.useRef(false);
  const updatesListRef = React.useRef(null);
  const updatesTouchStartYRef = React.useRef(0);
  const updatesDidTriggerRef = React.useRef(false);

  const scrollSelected = React.useCallback((align = 'center', behavior = 'auto') => {
    const idx = daysForPicker.findIndex(d => isSameDay(d, selectedDate));
    const apply = (container) => {
      if (!container || idx < 0) return;
      const el = container.querySelector(`[data-day-index="${idx}"]`);
      if (!el) return;

      // קודם ננסה את המובנה (מודע ל-RTL)
      try {
        el.scrollIntoView({ inline: align, block: 'nearest', behavior });
        return;
      } catch (_) {}

      // Fallback ידני (אם scrollIntoView לא מכבד inline/RTL)
      let left;
      if (align === 'start') {
        left = el.offsetLeft; // יישור להתחלה (ב-RTL זה ימין)
      } else if (align === 'end') {
        left = el.offsetLeft - (container.clientWidth - el.clientWidth); // יישור לסוף
      } else { // center
        left = el.offsetLeft - (container.clientWidth / 2 - el.clientWidth / 2);
      }
      container.scrollTo({ left: Math.max(left, 0), behavior });
    };

    apply(dayStripRef1.current);
    apply(dayStripRef2.current);
  }, [daysForPicker, selectedDate]);


// בכל שינוי יום אחרי הטעינה הראשונה – נגלול למרכז (מה שאהבת)
  React.useLayoutEffect(() => {
    if (!didInitialScrollRef.current) return;
    scrollSelected('center', 'auto');
  }, [scrollSelected]);

// בטעינה הראשונה: נשארים בתחילת שמאל (אין ימים אחורה)
  React.useEffect(() => {
    if (didInitialScrollRef.current) return;
    const containers = [dayStripRef1.current, dayStripRef2.current].filter(Boolean);

    // מכבים רגע את ה-snap שלא ימרכז לבד
    const prevSnaps = containers.map(c => c?.style.scrollSnapType || '');
    containers.forEach(c => { if (c) c.style.scrollSnapType = 'none'; });

    // מיישרים ל-"start" לוגי (ב-RTL זה ימין)
    requestAnimationFrame(() => {
      scrollSelected('start', 'auto');
      requestAnimationFrame(() => {
        containers.forEach((c, i) => { if (c) c.style.scrollSnapType = prevSnaps[i]; });
        didInitialScrollRef.current = true;
      });
    });
  }, [scrollSelected]);


  const serviceById = React.useCallback((id) => {
    return services.find((s) => s.id === id) || null;
  }, [services]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAdminCode("");
    navigate(createPageUrl("Home"));
  };

  // Helper: try .list/.all/.getAll/... so it works with your entities layer
  const listAny = async (entity, order) => {
    if (entity?.list)     return entity.list(order);
    if (entity?.all)      return entity.all(order);
    if (entity?.getAll)   return entity.getAll(order);
    if (entity?.findAll)  return entity.findAll(order);
    if (entity?.index)    return entity.index(order);
    if (entity?.filter)   return entity.filter({}, order);
    throw new Error("No list method on entity");
  };

  const listAdminPreferred = async (entity, order) => {
    if (entity?.adminList) return entity.adminList(order);
    return listAny(entity, order);
  };

  // מביא לקוחות מהדטהבייס דרך הסרבר (ללא קומבינות):
  const loadClients = async () => {
    // עדיפות לשכבת ה־entities (קורא ל־/clients מאחורה)
    if (Client?.list) {
      try {
        const arr = await Client.list();
        if (Array.isArray(arr)) return arr;
      } catch (e) {
        console.warn("Client.list failed, falling back to /clients", e);
      }
    }

    // נפילה חכמה ל־/clients ישירות (אם ה־entity לא נתמך בסביבה שלך)
    try {
      const res = await api.get("/clients");
      return Array.isArray(res) ? res : (res?.data ?? []);
    } catch (e) {
      console.error("loadClients fallback failed:", e);
      return [];
    }
  };

  const normalizeAppointmentsForDay = (items = []) => {
    const now = new Date();
    return (items || []).map((apt) => {
      const appointmentStartTime = new Date(apt.starts_at ?? apt.startsAt);
      const appointmentEndTime = new Date(apt.ends_at ?? apt.endsAt);

      if (isAfter(now, appointmentEndTime) && apt.status === 'booked') {
        // UI-only: מציג כ'הושלם' בלי לגעת בשרת
        return { ...apt, status: 'completed' };
      }
      return apt;
    });
  };

  const loadAppointmentsForDate = async (date) => {
    const data = await AdminApi.appointmentsByDate(date).catch(() => []);
    setAppointments(normalizeAppointmentsForDay(data));
  };

  const loadAppointmentsForWeek = async (date) => {
    const weekStart = startOfWeek(date, { weekStartsOn: 0 });
    const days = Array.from({ length: 6 }, (_, idx) => addDays(weekStart, idx)); // ראשון-שישי
    try {
      const responses = await Promise.all(
          days.map((day) => AdminApi.appointmentsByDate(day).catch(() => []))
      );
      const merged = responses.flat();
      const deduped = Array.from(
          new Map((merged || []).map((apt) => [String(apt?.id ?? `${apt?.starts_at}-${apt?.client_id ?? ''}`), apt])).values()
      );
      setWeeklyAppointmentsData(normalizeAppointmentsForDay(deduped));
    } catch (error) {
      console.error('Error loading weekly appointments:', error);
      setWeeklyAppointmentsData([]);
    }
  };

  const loadWaitingListForDate = async (date) => {
    try {
      const ymd = format(startOfDay(date), "yyyy-MM-dd");
      const data = await WaitingList.listAdmin({ date: ymd }).catch(() => []);
      setWaitingList(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error loading waiting list:", error);
      setWaitingList([]);
    }
  };

  const normalizeAdminUpdates = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .map((item) => ({ ...item }))
      .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
  };

  const loadAdminUpdates = async ({ withSpinner = false } = {}) => {
    if (withSpinner) setIsRefreshingUpdates(true);
    const startedAt = Date.now();
    try {
      const res = Setting?.get ? await Setting.get('admin.updates.feed').catch(() => null) : null;
      setAdminUpdates(normalizeAdminUpdates(res?.value));
    } catch (error) {
      console.error('Failed loading admin updates feed', error);
      setAdminUpdates([]);
    } finally {
      if (withSpinner) {
        const elapsed = Date.now() - startedAt;
        const waitMs = Math.max(0, 450 - elapsed);
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        setIsRefreshingUpdates(false);
      }
      setUpdatesPullDistance(0);
      updatesDidTriggerRef.current = false;
    }
  };


  const handleClearAdminUpdates = async () => {
    if (isClearingUpdates || isRefreshingUpdates) return;
    const ok = window.confirm('למחוק את כל העדכונים?');
    if (!ok) return;
    setIsClearingUpdates(true);
    try {
      await Setting.set('admin.updates.feed', []);
      setAdminUpdates([]);
      toast({ title: 'העדכונים נמחקו בהצלחה' });
    } catch (error) {
      console.error('Failed clearing admin updates feed', error);
      toast({
        title: 'שגיאה במחיקת העדכונים',
        description: 'נסה שוב בעוד רגע.',
        variant: 'destructive',
      });
    } finally {
      setIsClearingUpdates(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);

      const [
        allAppointmentsData, servicesData, testimonialsData,
        galleryData, hoursData, clientsData, backgroundVideosData,
        productsData, bookingRulesSetting
      ] = await Promise.all([
        AdminApi.appointmentsByDate(selectedDate).catch(() => []),
        listAdminPreferred(Service, "order_index").catch(() => []),
        listAdminPreferred(Testimonial, "order_index").catch(() => []),
        listAdminPreferred(GalleryImage, "order_index").catch(() => []),
        listAny(BusinessHours).catch(() => []),
        loadClients(),                                // ← לקוחות
        listAdminPreferred(BackgroundVideo).catch(() => []),     // ← סרטוני רקע (פעם אחת!)
        listAdminPreferred(Product, "order_index").catch(() => []),
        Setting?.get ? Setting.get('booking.rules').catch(() => null) : Promise.resolve(null),
      ]);

      const normalizedTestimonials = (testimonialsData || []).map((row) => {
        const rating = Number.isFinite(Number(row?.rating)) ? Number(row.rating) : 5;
        const content = (row?.content ?? row?.text ?? "").toString();
        return {
          ...row,
          rating,
          content,
          text: row?.text ?? content,
        };
      });

      setAppointments(normalizeAppointmentsForDay(allAppointmentsData));
      setServices(servicesData || []);
      setTestimonials(normalizedTestimonials);
      setGalleryImages(galleryData || []);
      setBusinessHours(hoursData || []);
      setBusinessHoursDirty(false);
      setBusinessHoursFeedback(null);
      setAllClients(clientsData || []);
      setBackgroundVideos(backgroundVideosData || []);
      setProducts(productsData || []);

      const normalizedBookingRules = normalizeBookingRules(bookingRulesSetting?.value);
      setMemberSettings(normalizedBookingRules);
      setMemberSettingsDirty(false);
      setMemberSettingsFeedback(null);
      await loadAdminUpdates();
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    loadAppointmentsForDate(selectedDate);
  }, [isAuthenticated, selectedDate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadWaitingListForDate(selectedDate);
  }, [isAuthenticated, selectedDate]);

  useEffect(() => {
    if (!isAuthenticated || appointmentsViewMode !== 'calendar') return;
    loadAppointmentsForWeek(selectedDate);
  }, [isAuthenticated, selectedDate, appointmentsViewMode]);


  useEffect(() => {
    if (!isAuthenticated || activeTab !== 'updates') return;
    const intervalId = setInterval(() => {
      loadAdminUpdates().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [isAuthenticated, activeTab]);

  const sanitizeTimeInput = (value) => {
    if (!value) return "";
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return "";
    const hh = String(match[1]).padStart(2, "0");
    const mm = String(match[2]).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const handleBusinessTimeChange = (weekday, field, value) => {
    const sanitized = sanitizeTimeInput(value);
    setBusinessHoursDraft((prev) =>
        prev.map((row) => (row.weekday === weekday ? { ...row, [field]: sanitized } : row))
    );
    setBusinessHoursDirty(true);
    setBusinessHoursFeedback(null);
  };

  const handleBusinessIntervalChange = (weekday, value) => {
    const minutes = Number(value);
    setBusinessHoursDraft((prev) =>
        prev.map((row) =>
            row.weekday === weekday
                ? {
                  ...row,
                  slotIntervalMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : row.slotIntervalMinutes,
                }
                : row
        )
    );
    setBusinessHoursDirty(true);
    setBusinessHoursFeedback(null);
  };

  const handleBusinessDayToggle = (weekday, isOpen) => {
    setBusinessHoursDraft((prev) =>
        prev.map((row) => {
          if (row.weekday !== weekday) return row;
          if (!isOpen) {
            return { ...row, isOpen: false };
          }
          const fallback = DEFAULT_MEMBER_DAY_HOURS.find((h) => Number(h.weekday) === Number(weekday)) || {};
          const nextOpen = sanitizeTimeInput(row.open || fallback.open || '10:00');
          const nextClose = sanitizeTimeInput(row.close || fallback.close || '18:00');
          return {
            ...row,
            isOpen: true,
            open: nextOpen,
            close: nextClose,
          };
        })
    );
    setBusinessHoursDirty(true);
    setBusinessHoursFeedback(null);
  };

  const handleSaveBusinessHours = async () => {
    try {
      setBusinessHoursSaving(true);
      setBusinessHoursFeedback(null);
      const rowsToSave = businessHoursDraft.map((row) => ({
        weekday: row.weekday,
        open: row.isOpen ? row.open : null,
        close: row.isOpen ? row.close : null,
        slotIntervalMinutes: Number(row.slotIntervalMinutes) || 30,
        isOpen: Boolean(row.isOpen),
      }));

      for (const row of rowsToSave) {
        if (row.isOpen) {
          const openMin = toMinutes(row.open);
          const closeMin = toMinutes(row.close);
          if (openMin == null || closeMin == null) {
            setBusinessHoursFeedback({
              type: 'error',
              message: `אנא הזינו שעות פתיחה וסגירה תקינות עבור ${WEEKDAY_LABELS[row.weekday]}.`,
            });
            setBusinessHoursSaving(false);
            return;
          }
          if (closeMin <= openMin) {
            setBusinessHoursFeedback({
              type: 'error',
              message: `שעת הסגירה חייבת להיות מאוחרת משעת הפתיחה עבור ${WEEKDAY_LABELS[row.weekday]}.`,
            });
            setBusinessHoursSaving(false);
            return;
          }
        }
      }

      const response = await BusinessHours.updateAll(rowsToSave);
      const normalized = Array.isArray(response) ? response : rowsToSave;
      setBusinessHours(normalized);
      setBusinessHoursDirty(false);
      setBusinessHoursFeedback({ type: 'success', message: 'שעות הפעילות נשמרו בהצלחה.' });
    } catch (error) {
      console.error('Failed to save business hours', error);
      setBusinessHoursFeedback({ type: 'error', message: 'שמירת שעות הפעילות נכשלה. נסה שוב.' });
    } finally {
      setBusinessHoursSaving(false);
    }
  };

  const getRecurringScheduleId = (recurring) => {
    if (!recurring) return null;
    const candidates = [
      recurring.schedule_id,
      recurring.scheduleId,
      recurring.recurring_schedule_id,
      recurring.recurringScheduleId,
      recurring.recurring_id,
      recurring.recurringId,
      recurring.recurring_uuid,
      recurring.recurringUuid,
      recurring.uuid,
      recurring.id,
    ];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined) continue;
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return String(candidate);
      }
    }
    return null;
  };

const describeRecurringSchedule = (recurring, clientId) => {
  if (!recurring) return null;
  const weekdayIndex = Number(recurring.weekday ?? recurring.day ?? 0);
  const boundedWeekday = Number.isInteger(weekdayIndex) && weekdayIndex >= 0 && weekdayIndex < WEEKDAY_LABELS.length
      ? weekdayIndex
      : 0;
  const timeLabel = recurring.start_time ?? recurring.startTime ?? '';
  const intervalWeeks = Number(recurring.intervalWeeks ?? recurring.interval_weeks ?? recurring.every ?? 1) || 1;
  const intervalMonths = Number(recurring.intervalMonths ?? recurring.interval_months ?? 0) || 0;
  const usesMonthly = intervalMonths > 0;
  const dayOfMonth = Number(recurring.day_of_month ?? recurring.dayOfMonth ?? recurring.day) || 0;
  const dayLabel = usesMonthly
      ? (dayOfMonth > 0 ? `${dayOfMonth} בחודש` : 'בחודש')
      : WEEKDAY_LABELS[boundedWeekday];
  const intervalLabel = usesMonthly
      ? intervalMonths === 1
          ? 'כל חודש'
          : `כל ${intervalMonths} חודשים`
      : intervalWeeks === 1
          ? 'כל שבוע'
          : intervalWeeks === 2
              ? 'כל שבועיים'
              : `כל ${intervalWeeks} שבועות`;
  const serviceLabel = recurring.service_name ?? recurring.serviceName ?? '';
  const id = getRecurringScheduleId(recurring);
  const scheduleKey = id ?? `${clientId}-${usesMonthly ? `month-${dayOfMonth}` : `week-${boundedWeekday}`}-${timeLabel || '00:00'}`;
  return {
    id,
    dayLabel,
    timeLabel,
    intervalWeeks,
    intervalMonths,
    intervalLabel,
    serviceLabel,
    scheduleKey,
    recurring,
  };
};

const normalizeRecurringSource = (source) => {
  if (!source) return [];
  if (Array.isArray(source)) return source.filter(Boolean);
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  if (typeof source === 'object') {
    if (Array.isArray(source.data)) return source.data.filter(Boolean);
    if (Array.isArray(source.items)) return source.items.filter(Boolean);
    return Object.values(source).filter((value) => {
      if (!value || typeof value !== 'object') return false;
      return (
          value.weekday !== undefined ||
          value.day !== undefined ||
          value.start_time !== undefined ||
          value.startTime !== undefined
      );
    });
  }
  return [];
};

const extractRecurringSchedules = (client) => {
  const sources = [
    client?.recurringAppointments,
    client?.recurring_appointments,
    client?.recurring,
    client?.recurringSchedules,
    client?.recurring_schedules,
  ];
  for (const source of sources) {
    const parsed = normalizeRecurringSource(source);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
};

  const memberOnlyServiceSet = useMemo(
      () => new Set((memberSettings.memberOnlyServiceIds || []).map((id) => String(id))),
      [memberSettings.memberOnlyServiceIds]
  );

  const memberWindowsByDay = useMemo(() => {
    const grouped = Array.from({ length: 7 }, () => []);
    for (const window of memberSettings.memberOnlyWindows || []) {
      const day = Number(window.weekday);
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      grouped[day].push(window);
    }
    return grouped.map((arr) => [...arr].sort((a, b) => a.start.localeCompare(b.start)));
  }, [memberSettings.memberOnlyWindows]);

  const updateAdvanceDays = (field, rawValue, fallback) => {
    const sanitized = clampAdvanceDays(rawValue, fallback);
    setMemberSettings((prev) => ({ ...prev, [field]: sanitized }));
    setMemberSettingsDirty(true);
    setMemberSettingsFeedback(null);
  };

  const handlePublicAdvanceChange = (value) => {
    updateAdvanceDays('publicMaxAdvanceDays', value, DEFAULT_BOOKING_RULES.publicMaxAdvanceDays);
  };

  const handleMemberAdvanceChange = (value) => {
    updateAdvanceDays('memberMaxAdvanceDays', value, DEFAULT_BOOKING_RULES.memberMaxAdvanceDays);
  };

  const toggleMemberOnlyService = (serviceId, checked) => {
    const idStr = String(serviceId ?? '');
    if (!idStr) return;
    setMemberSettings((prev) => {
      const current = new Set((prev.memberOnlyServiceIds || []).map((id) => String(id)));
      if (checked) {
        current.add(idStr);
      } else {
        current.delete(idStr);
      }
      return { ...prev, memberOnlyServiceIds: Array.from(current) };
    });
    setMemberSettingsDirty(true);
    setMemberSettingsFeedback(null);
  };

  const handleSaveMemberSettings = async () => {
    try {
      setMemberSettingsSaving(true);
      setMemberSettingsFeedback(null);
      const payload = sanitizeBookingRulesForSave(memberSettings);
      await Setting.set('booking.rules', payload);
      const normalized = normalizeBookingRules(payload);
      setMemberSettings(normalized);
      setMemberSettingsDirty(false);
      setMemberSettingsFeedback({ type: 'success', message: 'ההגדרות נשמרו בהצלחה.' });
    } catch (err) {
      console.error('Failed to save member settings', err);
      setMemberSettingsFeedback({ type: 'error', message: 'שמירת ההגדרות נכשלה. נסה שוב.' });
    } finally {
      setMemberSettingsSaving(false);
    }
  };

  useEffect(() => {
    const availableIds = new Set((services || []).map((svc) => String(svc.id ?? '')));
    const currentIds = (memberSettings.memberOnlyServiceIds || []).map((id) => String(id));
    const filtered = currentIds.filter((id) => availableIds.has(id));
    const changed =
        filtered.length !== currentIds.length ||
        filtered.some((id, index) => id !== currentIds[index]);
    if (changed) {
      setMemberSettings((prev) => ({ ...prev, memberOnlyServiceIds: filtered }));
      setMemberSettingsDirty(true);
      setMemberSettingsFeedback(null);
    }
  }, [services, memberSettings.memberOnlyServiceIds]);

  const getAppointmentsForDay = (date) => {
    return appointments
        .filter(apt =>
            apt.status !== 'canceled' &&
            apt.status !== 'blocked' &&            // 👈 אל תציג חסימות ביומן התורים
            isSameDay(new Date(apt.starts_at), date)
        )
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  };

  const weeklyCalendarStart = useMemo(
      () => startOfWeek(selectedDate, { weekStartsOn: 0 }),
      [selectedDate]
  );

  const weeklyCalendarDays = useMemo(
      () => Array.from({ length: 6 }, (_, idx) => addDays(weeklyCalendarStart, idx)),
      [weeklyCalendarStart]
  );

  const weeklyAppointments = useMemo(() => {
    const weekStart = startOfDay(weeklyCalendarStart);
    const weekEnd = addDays(weekStart, 6);
    return (weeklyAppointmentsData || [])
        .filter((apt) => {
          if (apt.status === 'canceled' || apt.status === 'blocked') return false;
          const start = new Date(apt.starts_at);
          return start >= weekStart && start < weekEnd;
        })
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }, [weeklyAppointmentsData, weeklyCalendarStart]);

  const calendarBounds = useMemo(() => {
    const fallbackStart = 8 * 60;
    const fallbackEnd = 21 * 60;
    const opens = (businessHours || [])
        .map((row) => toMinutes(row?.open || row?.opens_at || row?.open_time))
        .filter((val) => Number.isFinite(val));
    const closes = (businessHours || [])
        .map((row) => toMinutes(row?.close || row?.closes_at || row?.close_time))
        .filter((val) => Number.isFinite(val));

    const minOpen = opens.length ? Math.min(...opens) : fallbackStart;
    const maxClose = closes.length ? Math.max(...closes) : fallbackEnd;

    const startMinutes = Math.max(0, Math.floor(minOpen / 30) * 30);
    const endMinutes = Math.min(24 * 60, Math.ceil(maxClose / 30) * 30 + 30);
    return {
      startMinutes,
      endMinutes: endMinutes > startMinutes ? endMinutes : startMinutes + 30,
      slotMinutes: 30,
    };
  }, [businessHours]);

  const calendarTimeSlots = useMemo(() => {
    const slots = [];
    for (let minute = calendarBounds.startMinutes; minute < calendarBounds.endMinutes; minute += calendarBounds.slotMinutes) {
      slots.push(minute);
    }
    return slots;
  }, [calendarBounds]);

  const canDragAppointmentInCalendar = React.useCallback((appointment) => {
    if (!appointment) return false;
    if (appointment.status === 'canceled' || appointment.status === 'blocked' || appointment.status === 'completed') return false;
    const endAt = new Date(appointment.ends_at ?? appointment.endsAt);
    if (Number.isNaN(endAt.getTime())) return false;
    return isAfter(endAt, new Date());
  }, []);

  const handleCalendarDrop = (appointmentId, dayDate, slotMinute) => {
    const appointment = (weeklyAppointmentsData || []).find((apt) => String(apt.id) === String(appointmentId));
    if (!appointment || !canDragAppointmentInCalendar(appointment)) return;
    const currentStart = new Date(appointment.starts_at);
    const durationMinutes = Math.max(
        30,
        Math.round((new Date(appointment.ends_at).getTime() - currentStart.getTime()) / 60000) ||
        Number(appointment?.duration_minutes ?? appointment?.service_duration_minutes ?? appointment?.duration ?? 30)
    );
    const nextStart = setMinutes(setHours(startOfDay(dayDate), Math.floor(slotMinute / 60)), slotMinute % 60);
    const nextEnd = addMinutes(nextStart, durationMinutes);
    if (currentStart.getTime() === nextStart.getTime()) {
      return;
    }
    setPendingCalendarMove({
      appointmentId: appointment.id,
      clientName: getAppointmentDisplayInfo(appointment).name,
      fromLabel: format(currentStart, 'EEE dd/MM HH:mm', { locale: he }),
      toLabel: format(nextStart, 'EEE dd/MM HH:mm', { locale: he }),
      newStart: nextStart,
      newEnd: nextEnd,
    });
  };


  const handleCalendarTouchDrop = React.useCallback((touchPoint) => {
    if (!draggedAppointmentId || !touchPoint) return;
    const target = document.elementFromPoint(touchPoint.clientX, touchPoint.clientY);
    const cell = target?.closest?.('[data-calendar-cell="1"]');
    if (!cell) return;
    const dateValue = cell.getAttribute('data-day-date');
    const slotValue = Number(cell.getAttribute('data-slot-minute'));
    if (!dateValue || !Number.isFinite(slotValue)) return;
    const dayDate = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(dayDate.getTime())) return;
    handleCalendarDrop(draggedAppointmentId, dayDate, slotValue);
  }, [draggedAppointmentId, handleCalendarDrop]);

  const startCalendarDragPreview = React.useCallback((appointment, point) => {
    if (!appointment || !point) return;
    const title = getAppointmentDisplayInfo(appointment).name || 'לקוח';
    const time = format(new Date(appointment.starts_at), 'HH:mm');
    setDragPreview({
      title,
      time,
      x: point.clientX,
      y: point.clientY,
    });
  }, [getAppointmentDisplayInfo]);

  const moveCalendarDragPreview = React.useCallback((point) => {
    if (!point) return;
    setDragPreview((prev) => prev ? ({ ...prev, x: point.clientX, y: point.clientY }) : prev);
  }, []);

  const endCalendarDragPreview = React.useCallback(() => {
    setDragPreview(null);
  }, []);

  const submitCalendarMove = async () => {
    if (!pendingCalendarMove?.appointmentId || !pendingCalendarMove.newStart || !pendingCalendarMove.newEnd) return;
    try {
      setIsSavingCalendarMove(true);
      if (AdminApi?.reschedule) {
        await AdminApi.reschedule(
            pendingCalendarMove.appointmentId,
            pendingCalendarMove.newStart.toISOString(),
            pendingCalendarMove.newEnd.toISOString()
        );
      } else if (AdminApi?.appointments?.reschedule) {
        await AdminApi.appointments.reschedule(
            pendingCalendarMove.appointmentId,
            pendingCalendarMove.newStart.toISOString(),
            pendingCalendarMove.newEnd.toISOString()
        );
      } else {
        await Appointment.update(pendingCalendarMove.appointmentId, {
          starts_at: pendingCalendarMove.newStart.toISOString(),
          ends_at: pendingCalendarMove.newEnd.toISOString(),
        });
      }
      toast({ title: 'התור עודכן בהצלחה' });
      setPendingCalendarMove(null);
      await Promise.all([loadData(), loadAppointmentsForWeek(pendingCalendarMove.newStart)]);
    } catch (error) {
      console.error('Failed to move appointment from weekly calendar', error);
      toast({ title: 'העברת התור נכשלה', description: 'נסה שוב בעוד רגע.', variant: 'destructive' });
    } finally {
      setIsSavingCalendarMove(false);
    }
  };

  const getWaitingListForDay = (date) => {
    return waitingList
        .filter(entry => {
          const desiredDate = entry.desired_date ?? entry.desiredDate;
          if (desiredDate) {
            return isSameDay(new Date(desiredDate), date);
          }
          const desiredStartsAt = entry.desired_starts_at ?? entry.desiredStartsAt;
          return desiredStartsAt ? isSameDay(new Date(desiredStartsAt), date) : false;
        })
        .sort((a, b) => {
          const timeA = a.desired_time ?? a.desiredTime ?? format(new Date(a.desired_starts_at ?? a.desiredStartsAt), 'HH:mm');
          const timeB = b.desired_time ?? b.desiredTime ?? format(new Date(b.desired_starts_at ?? b.desiredStartsAt), 'HH:mm');
          if (timeA !== timeB) return String(timeA).localeCompare(String(timeB));
          const memberA = Boolean(a.is_club_member ?? a.isClubMember);
          const memberB = Boolean(b.is_club_member ?? b.isClubMember);
          if (memberA !== memberB) return memberA ? -1 : 1;
          const createdA = new Date(a.created_at ?? a.createdAt ?? 0).getTime();
          const createdB = new Date(b.created_at ?? b.createdAt ?? 0).getTime();
          return createdA - createdB;
        });
  };

  const getWaitingEntryTime = (entry) => {
    return (
        entry.desired_time ??
        entry.desiredTime ??
        format(new Date(entry.desired_starts_at ?? entry.desiredStartsAt), 'HH:mm')
    );
  };

  const waitingListGroups = useMemo(() => {
    const groups = {};
    getWaitingListForDay(selectedDate).forEach((entry) => {
      const time = getWaitingEntryTime(entry);
      if (!groups[time]) groups[time] = [];
      groups[time].push(entry);
    });
    return groups;
  }, [waitingList, selectedDate]);

  const toggleWaitingTimeGroup = (time) => {
    setExpandedWaitingTimes((prev) => {
      const next = new Set(prev);
      if (next.has(time)) {
        next.delete(time);
      } else {
        next.add(time);
      }
      return next;
    });
  };


  const handleStatusChange = async (appointment, newStatus) => {
    try {
      await Appointment.update(appointment.id, { status: newStatus });
      loadData();
      setSelectedAppointment(null);
    } catch (error) {
      console.error("Error updating appointment:", error);
    }
  };

  const formatRecurringConflict = (conflict) => {
    if (!conflict) return '';
    const startRaw = conflict.starts_at ?? conflict.startsAt ?? conflict.start_at ?? conflict.startAt ?? conflict.start;
    let dateLabel = '';
    let timeLabel = '';
    if (startRaw) {
      try {
        const startDate = new Date(startRaw);
        if (!Number.isNaN(startDate.getTime())) {
          dateLabel = format(startDate, 'dd/MM/yyyy', { locale: he });
          timeLabel = format(startDate, 'HH:mm');
        }
      } catch (_) {
        dateLabel = String(startRaw);
      }
    }
    const baseLabel = conflict.type === 'blocked'
        ? `חסימה${conflict.reason ? `: ${conflict.reason}` : ''}`
        : conflict.client_name || 'תור תפוס';
    const serviceLabel = conflict.service_name ? ` · ${conflict.service_name}` : '';
    const prefix = [dateLabel, timeLabel].filter(Boolean).join(' ');
    return `${prefix ? `${prefix} · ` : ''}${baseLabel}${serviceLabel}`;
  };

  const closeRecurringSuccessModal = () => {
    setRecurringSuccessModal({ isOpen: false, message: '', skippedDates: [] });
  };

  const closeMessageModal = () => {
    setShowMessageModal(false);
    setMessageText('');
    setSendingMessage(false);
  };

  const handleSendGeneralWhatsApp = async () => {
    if (sendingMessage) return;
    const text = messageText.trim();
    if (!text) {
      toast({ title: 'נא למלא תוכן הודעה', variant: 'destructive' });
      return;
    }
    try {
      setSendingMessage(true);
      await AdminApi.whatsappBroadcast({ messageText: text });
      toast({ title: 'ההודעה נשלחה בהצלחה' });
      setShowMessageModal(false);
      setMessageText('');
    } catch (error) {
      const description = error?.message || 'שליחת ההודעה נכשלה';
      toast({ title: 'שגיאה בשליחת הודעה', description, variant: 'destructive' });
    } finally {
      setSendingMessage(false);
    }
  };

  const closeRecurringConflictModal = () => {
    setRecurringConflictModal({ isOpen: false, message: '', conflicts: [], hasMore: false });
  };

  const closeRecurringCancelModal = () => {
    setRecurringCancelModal({ ...RECURRING_CANCEL_INITIAL });
  };

  const startRecurringCancelFlow = (recurringMeta, clientName) => {
    if (!recurringMeta) return;
    const schedule = recurringMeta.recurring ?? recurringMeta;
    const scheduleId = recurringMeta.id ?? getRecurringScheduleId(schedule);
    if (!scheduleId) {
      toast({
        title: 'לא ניתן לבטל את התור הקבוע',
        description: 'לא נמצא מזהה תקין לתור הקבוע. נסה לרענן את העמוד.',
        variant: 'destructive',
      });
      return;
    }
    setRecurringCancelModal({
      isOpen: true,
      schedule,
      scheduleId,
      clientName: clientName || 'לקוח',
      scheduleLabel: recurringMeta.dayLabel
          ? `${recurringMeta.dayLabel}${recurringMeta.timeLabel ? ` ${recurringMeta.timeLabel}` : ''}`
          : '',
      intervalLabel: recurringMeta.intervalLabel || '',
      serviceLabel: recurringMeta.serviceLabel || '',
    });
  };

  const handleConfirmRecurringCancellation = async () => {
    if (!recurringCancelModal.schedule || !recurringCancelModal.scheduleId) {
      toast({
        title: 'לא ניתן לבטל את התור הקבוע',
        description: 'לא נמצאו נתונים לביטול התור הקבוע. נסה שוב.',
        variant: 'destructive',
      });
      return;
    }
    const scheduleId = recurringCancelModal.scheduleId;
    try {
      setCancelingRecurringId(scheduleId);
      await AdminApi.appointments.cancelRecurring(scheduleId);
      toast({
        title: 'התור הקבוע בוטל',
        description: `${recurringCancelModal.clientName}${recurringCancelModal.scheduleLabel ? ` · ${recurringCancelModal.scheduleLabel}` : ''} הוסר מהלו"ז וכל התורים העתידיים נמחקו.`,
      });
      closeRecurringCancelModal();
      await loadData();
    } catch (error) {
      console.error('Failed to cancel recurring appointment', error);
      const message = error?.payload?.message || error?.payload?.error || 'ביטול התור הקבוע נכשל. נסה שוב.';
      toast({ title: 'ביטול נכשל', description: message, variant: 'destructive' });
    } finally {
      setCancelingRecurringId(null);
    }
  };

  const handleCreateRecurringAppointment = React.useCallback(async (appointment, intervalConfig) => {
    if (!appointment?.id) return;
    try {
      const response = await AdminApi.appointments.createRecurring(appointment.id, intervalConfig);
      await loadData();
      setRecurringSuccessModal({
        isOpen: true,
        message: 'תורים קבועים נקבעו בהצלחה לחצי השנה הקרובה!',
        skippedDates: [],
      });
    } catch (error) {
      console.error('Failed to create recurring appointment', error);
      const payload = error?.payload;
      if (payload?.error === 'RECURRING_CONFLICT') {
        setRecurringConflictModal({
          isOpen: true,
          message: payload?.message || 'לא ניתן לקבוע תור קבוע כי קיימים תורים מתנגשים.',
          conflicts: Array.isArray(payload?.conflicts) ? payload.conflicts : [],
          hasMore: Boolean(payload?.hasMore),
        });
      } else {
        const message = payload?.message || payload?.error || error?.message || 'יצירת התור הקבוע נכשלה. נסה שוב.';
        alert(message);
      }
      throw error;
    }
  }, [loadData]);

  const handleRescheduleSubmit = async (appointment, service, newStartTime) => {
    try {
      if (!appointment?.id || !newStartTime) return;
      const startAt = new Date(newStartTime);
      if (Number.isNaN(startAt.getTime())) {
        alert("שעה לא תקינה. נסה לבחור שעה מחדש.");
        return;
      }
      const durationMinutes =
        service?.duration_minutes ??
        appointment?.duration_minutes ??
        appointment?.service_duration_minutes ??
        appointment?.duration ??
        30;
      const newEndTime = addMinutes(startAt, durationMinutes);

      if (AdminApi?.reschedule) {
        await AdminApi.reschedule(appointment.id, startAt.toISOString(), newEndTime.toISOString());
      } else if (AdminApi?.appointments?.reschedule) {
        await AdminApi.appointments.reschedule(appointment.id, startAt.toISOString(), newEndTime.toISOString());
      } else {
        await Appointment.update(appointment.id, {
          starts_at: startAt.toISOString(),
          ends_at: newEndTime.toISOString(),
        });
      }

      await loadData();
    } catch (error) {
      console.error("Error rescheduling appointment:", error);
      alert("שגיאה בהחלפת התור.");
    }
  };


  const handleDelete = async (entity, id, entityName) => {
    if (!id) return;
    if (!confirm(`האם אתה בטוח שברצונך למחוק ${entityName}?`)) return;

    try {
      const status = (e) => e?.status || e?.response?.status;

      // אם מוחקים תור - נשתמש ב-Admin API כדי שהבקשה תגיע ל-/admin/appointments/:id
      if (entity === Appointment && AdminApi?.appointments?.delete) {
        await AdminApi.appointments.delete(id);
      } else {
        const fn = entity.delete || entity.destroy || entity.remove || entity.del;
        if (!fn) throw new Error("No delete/destroy/remove method on entity");
        await fn.call(entity, id);
      }

      await loadData();
    } catch (error) {
      const s = error?.status || error?.response?.status;
      if (s === 404) {
        // כבר נמחק/לא קיים – נרענן בשקט
        await loadData();
      } else {
        console.error(`Error deleting ${entityName}:`, error);
        alert("שגיאה במחיקת הפריט.");
      }
    }
  };


  const handleDragEnd = async (result, list, setList, entity) => {
    const { destination, source } = result;
    if (!destination) return;
    if (destination.index === source.index) return;

    const reorderedList = Array.from(list);
    const [removed] = reorderedList.splice(source.index, 1);
    reorderedList.splice(destination.index, 0, removed);

    setList(reorderedList);

    try {
      const updatePromises = reorderedList.map((item, index) => {
        const payload = {
          ...item,
          orderIndex: index,
          order_index: index,
        };
        return entity.update(item.id, payload);
      });
      await Promise.all(updatePromises);
    } catch (error) {
      console.error("Failed to update order:", error);
      alert("שגיאה בעדכון הסדר. נסה לרענן את העמוד.");
      setList(list);
    }
  };

  const handleServiceSubmit = async (serviceData) => {
    try {
      if (editingService) {
        await Service.update(editingService.id, serviceData);
      } else {
        await Service.create(serviceData);
      }
      loadData();
      setShowServiceForm(false);
      setEditingService(null);
    } catch (error) {
      console.error("Error saving service:", error);
    }
  };

  const handleTestimonialSubmit = async (testimonialData) => {
    const contentValue = (testimonialData.content ?? testimonialData.text ?? "").toString();
    const payload = {
      author: testimonialData.author?.trim() || "",
      rating: Number.isFinite(Number(testimonialData.rating)) ? Number(testimonialData.rating) : 5,
      content: contentValue.trim(),
      text: (testimonialData.text ?? testimonialData.content ?? "").toString().trim(),
    };

    try {
      if (editingTestimonial) {
        await Testimonial.update(editingTestimonial.id, payload);
      } else {
        await Testimonial.create(payload);
      }
      loadData();
      setShowTestimonialForm(false);
      setEditingTestimonial(null);
    } catch (error) {
      console.error("Error saving testimonial:", error);
    }
  };

  const handleProductSubmit = async (productData) => {
    try {
      if (editingProduct) {
        await Product.update(editingProduct.id, productData);
      } else {
        await Product.create(productData);
      }
      loadData();
      setShowProductForm(false);
      setEditingProduct(null);
    } catch (error) {
      console.error("Error saving product:", error);
    }
  };

  const handleClientSubmit = async (clientData) => {
    try {
      const normalizedPhone = normalizePhone(clientData.phone);
      const existingClient = allClients.find(c => normalizePhone(c.phone) === normalizedPhone);

      if (existingClient) {
        alert("לקוח עם מספר טלפון זה כבר קיים.");
        return;
      }

      const payload = {
        first_name: clientData.first_name ?? clientData.firstName ?? "",
        last_name: clientData.last_name ?? clientData.lastName ?? "",
        phone: normalizedPhone,
        is_member: Boolean(clientData.is_member ?? clientData.isMember ?? false),
      };
      await Client.create(payload);
      loadData();
      setShowClientForm(false);
    } catch (error) {
      console.error("Error saving client:", error);
      alert("שגיאה בהוספת הלקוח.");
    }
  };

  const parseClientImportFile = async (file) => {
    const XLSX = await loadXlsxLibrary();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName) {
      return { entries: [], invalidRows: [{ row: 0, reason: "לא נמצא גיליון בקובץ." }] };
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) {
      return { entries: [], invalidRows: [{ row: 0, reason: "אין שורות נתונים בקובץ." }] };
    }

    const headerValues = rows[0].map((value) => String(value ?? "").trim().toLowerCase());
    const looksLikeHeader = headerValues.some((value) =>
      value.includes("שם") || value.includes("טלפון") || value.includes("phone")
    );
    const dataRows = rows.slice(looksLikeHeader ? 1 : 0);

    const invalidRows = [];
    const entries = [];
    const seenPhones = new Set();

    dataRows.forEach((row, index) => {
      const [firstName, lastName, phoneValue] = row ?? [];
      const first = String(firstName ?? "").trim();
      const last = String(lastName ?? "").trim();
      const normalized = normalizePhone(phoneValue);
      const hasAny = first || last || normalized;
      const rowIndex = index + 1 + (looksLikeHeader ? 1 : 0);

      if (!hasAny) return;

      if (!normalized) {
        invalidRows.push({ row: rowIndex, reason: "חסר מספר טלפון." });
        return;
      }

      if (seenPhones.has(normalized)) {
        invalidRows.push({ row: rowIndex, reason: "מספר טלפון כפול בקובץ." });
        return;
      }

      seenPhones.add(normalized);
      entries.push({ first_name: first, last_name: last, phone: normalized, rowIndex });
    });

    return { entries, invalidRows };
  };

  const handleImportClientsFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setImportClientsFile(null);
      setImportClientsPreview([]);
      setImportClientsFeedback(null);
      return;
    }
    setImportClientsFile(file);
    setImportClientsLoading(true);
    try {
      const { entries, invalidRows } = await parseClientImportFile(file);
      setImportClientsPreview(entries.slice(0, 5));
      setImportClientsFeedback({
        entriesCount: entries.length,
        invalidRows,
      });
    } catch (error) {
      console.error("Failed parsing client import file", error);
      setImportClientsPreview([]);
      setImportClientsFeedback({
        entriesCount: 0,
        invalidRows: [{ row: 0, reason: "לא ניתן לקרוא את הקובץ." }],
      });
    } finally {
      setImportClientsLoading(false);
    }
  };

  const handleImportClients = async () => {
    if (!importClientsFile) {
      setImportClientsFeedback({
        entriesCount: 0,
        invalidRows: [{ row: 0, reason: "בחר קובץ כדי להתחיל." }],
      });
      return;
    }
    setImportClientsLoading(true);
    try {
      const { entries, invalidRows } = await parseClientImportFile(importClientsFile);
      const existingPhones = new Set(
        (allClients || [])
          .map((client) => normalizePhone(client.phone ?? client.client_phone ?? ""))
          .filter(Boolean)
      );
      let createdCount = 0;
      let skippedExisting = 0;
      let failedCount = 0;

      for (const entry of entries) {
        if (existingPhones.has(entry.phone)) {
          skippedExisting += 1;
          continue;
        }
        const created = await safeCreateClient(entry);
        if (created) {
          createdCount += 1;
          existingPhones.add(entry.phone);
        } else {
          failedCount += 1;
        }
      }

      await loadData();
      setImportClientsFeedback({
        entriesCount: entries.length,
        invalidRows,
        createdCount,
        skippedExisting,
        failedCount,
      });
    } catch (error) {
      console.error("Client import failed", error);
      setImportClientsFeedback({
        entriesCount: 0,
        invalidRows: [{ row: 0, reason: "הייבוא נכשל. נסה שוב." }],
      });
    } finally {
      setImportClientsLoading(false);
    }
  };

  const toggleClientMembership = async (client) => {
    if (!client?.id) return;
    const current = Boolean(client.isMember ?? client.is_member);
    const payload = {
      is_member: !current,
      first_name: client.first_name ?? client.firstName ?? "",
      last_name: client.last_name ?? client.lastName ?? "",
      phone: normalizePhone(client.phone ?? client.client_phone ?? ""),
    };
    try {
      if (Client?.update) {
        await Client.update(client.id, payload);
      } else {
        await api.put(`/clients/${client.id}`, payload);
      }
      loadData();
    } catch (error) {
      console.error("Error updating membership:", error);
      alert("שגיאה בעדכון סטטוס המועדון.");
    }
  };

  const openClientDetails = (client) => {
    if (!client) return;
    setClientDetailsModal({ isOpen: true, client });
  };

  const closeClientDetailsModal = () => {
    setClientDetailsModal({ isOpen: false, client: null });
  };

  const handleClientCardKeyDown = (event, client) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openClientDetails(client);
    }
  };

  const handleCancelSingleAppointment = async (appointment) => {
    if (!appointment?.id) return;
    const service = serviceById(appointment.service_id);
    const serviceLabel = service?.name ?? service?.title ?? '';
    const startsLabel = (() => {
      if (!appointment?.starts_at) return '';
      try {
        return format(new Date(appointment.starts_at), 'dd/MM/yyyy · HH:mm', { locale: he });
      } catch (_) {
        return appointment.starts_at;
      }
    })();
    const confirmMessage = `האם לבטל את התור${startsLabel ? ` ב-${startsLabel}` : ''}${serviceLabel ? ` (${serviceLabel})` : ''}?`;
    if (!window.confirm(confirmMessage)) return;
    try {
      setCancelingAppointmentId(appointment.id);
      await AdminApi.appointments.delete(appointment.id);
      toast({
        title: 'התור בוטל',
        description: startsLabel ? `התור ל-${startsLabel} בוטל בהצלחה.` : 'התור בוטל בהצלחה.',
      });
      await loadData();
      if (clientDetailsModal?.isOpen && clientDetailsModal?.client) {
        await fetchClientAppointments(clientDetailsModal.client);
      }
    } catch (error) {
      console.error('Failed to cancel appointment', error);
      const description = error?.payload?.message || error?.payload?.error || error?.message || 'ביטול התור נכשל. נסה שוב.';
      toast({ title: 'שגיאה בביטול התור', description, variant: 'destructive' });
    } finally {
      setCancelingAppointmentId(null);
    }
  };

  // Admin.jsx – ליד שאר העזרים, מעל handleAddAppointment
  const safeCreateClient = async ({ first_name = "", last_name = "", phone = "" }) => {
    const payload = { first_name, last_name, phone: normalizePhone(phone) };
    try {
      if (Client?.create) {
        await Client.create(payload);   // יורה אל /clients לפי ה-entities
        return true;
      }
    } catch (e) {
      // אם אין ראוט /clients, ננסה /admin/clients
      const is404 = (e && (e.status === 404 || /404/.test(String(e))) );
      if (is404) {
        try {
          await api.post("/admin/clients", payload);
          return true;
        } catch (_) {
          // מתעלמים בשקט – לא שוברים את יצירת התור
        }
      }
    }
    return false; // לא קריטי לכישלון יצירת תור
  };

  const handleAddAppointment = async (appointmentData) => {
    try {
      const normalizedPhone = normalizePhone(appointmentData.phone);

      // אין יצירת לקוח! רק יצירת תור.
      await Appointment.create({
        ...appointmentData,
        phone: normalizedPhone,
        // רמז לאחוריים: לא ליצור לקוח
        createClient: false,
        is_guest: true,
      });

      loadData();
    } catch (error) {
      console.error("Error adding appointment:", error);
      alert("שגיאה בהוספת התור: " + (error.message || "נסה שוב."));
    }
  };


  const getMonthlyStats = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const monthlyAppointments = appointments.filter(apt => {
      const aptDate = new Date(apt.starts_at);
      return aptDate.getMonth() === currentMonth &&
          aptDate.getFullYear() === currentYear &&
          apt.status === 'completed';
    });

    const monthlyRevenue = monthlyAppointments.reduce((total, apt) => {
      const service = serviceById(apt.service_id)
      return total + (service?.price || 0);
    }, 0);

    const newClientsThisMonth = allClients.filter(client => {
      const clientDate = new Date(client.created_date);
      return clientDate.getMonth() === currentMonth &&
          clientDate.getFullYear() === currentYear;
    }).length;

    return {
      totalClients: allClients.length,
      monthlyAppointments: monthlyAppointments.length,
      monthlyRevenue,
      newClientsThisMonth
    };
  };

  const clientDataWithAppointments = useMemo(() => {
    const now = new Date();
    return (allClients || []).map(c => {
      // לא מסננים לקוחות בלי טלפון – פשוט לא תהיה להם היסטוריה תורים
      const cPhone = normalizePhone(c.phone ?? c.client_phone ?? "");
      const apiLastAppointment =
          c.lastAppointmentAt ??
          c.last_appointment_at ??
          c.last_appointment ??
          c.lastAppointment ??
          null;

      const clientApts = (appointments || [])
          .filter(apt => {
            const aptPhone = normalizePhone(
                apt?.client_phone || apt?.phone || apt?.client?.phone || ""
            );
            const notCanceled = apt?.status !== "canceled";
            const notFuture   = apt?.starts_at ? new Date(apt.starts_at) <= now : false;
            return cPhone && aptPhone === cPhone && notCanceled && notFuture;
          })
          .sort((a,b) => new Date(b.starts_at) - new Date(a.starts_at));

      const last = clientApts[0] || null;
      const lastDateFromAppointments = last ? new Date(last.starts_at) : null;
      const lastDateFromApi = apiLastAppointment ? new Date(apiLastAppointment) : null;
      const normalizedApiDate =
          lastDateFromApi && !Number.isNaN(lastDateFromApi.getTime()) ? lastDateFromApi : null;
      const lastDateFromSchedule =
          lastDateFromAppointments && !Number.isNaN(lastDateFromAppointments.getTime())
              ? lastDateFromAppointments
              : null;
      const lastDate = normalizedApiDate ?? lastDateFromSchedule;
      const isRecent = lastDate ? differenceInDays(now, lastDate) <= 30 : false;

      return { ...c, lastAppointmentDate: lastDate, lastAppointmentRecent: isRecent };
    });
  }, [allClients, appointments]);

  const normalizeAppointmentRows = React.useCallback((items = []) => {
    return (items || []).map((apt) => {
      if (!apt || typeof apt !== 'object') return apt;
      return {
        ...apt,
        starts_at: apt.starts_at ?? apt.startsAt ?? null,
        ends_at: apt.ends_at ?? apt.endsAt ?? null,
        service_id: apt.service_id ?? apt.serviceId ?? null,
        client_phone: apt.client_phone ?? apt.phone ?? apt.client?.phone ?? null,
      };
    });
  }, []);

  const filterUpcomingAppointments = React.useCallback((items = []) => {
    const now = new Date();
    return (items || [])
        .filter((apt) => {
          if (!apt) return false;
          if (apt?.status === 'canceled') return false;
          if (!apt?.starts_at) return false;
          try {
            return new Date(apt.starts_at) > now;
          } catch (_) {
            return false;
          }
        })
        .sort((a, b) => {
          const timeA = a?.starts_at ? new Date(a.starts_at).getTime() : 0;
          const timeB = b?.starts_at ? new Date(b.starts_at).getTime() : 0;
          return timeA - timeB;
        });
  }, []);

  const filterAppointmentsForClient = React.useCallback((items = [], client) => {
    if (!client) return [];
    const clientId = client.id ?? client.client_id ?? null;
    const normalizedPhone = normalizePhone(client.phone ?? client.client_phone ?? "");
    return (items || [])
        .filter((apt) => {
          if (!apt) return false;
          const aptClientId = apt.client_id ?? apt.clientId ?? apt.client?.id;
          if (clientId && aptClientId && String(aptClientId) === String(clientId)) {
            return true;
          }
          const aptPhone = normalizePhone(apt.client_phone ?? apt.phone ?? apt.client?.phone ?? "");
          return Boolean(normalizedPhone && aptPhone && aptPhone === normalizedPhone);
        });
  }, []);

  const getClientAppointments = React.useCallback((client) => {
    if (!client) return [];
    const forClient = filterAppointmentsForClient(appointments || [], client);
    return normalizeAppointmentRows(forClient);
  }, [appointments, filterAppointmentsForClient, normalizeAppointmentRows]);

  const fetchClientAppointments = React.useCallback(async (client) => {
    if (!client) {
      setClientDetailsAppointmentsAll([]);
      return;
    }
    const clientId = client.id ?? client.client_id ?? null;
    const normalizedPhone = normalizePhone(client.phone ?? client.client_phone ?? "");
    if (!clientId && !normalizedPhone) {
      setClientDetailsAppointmentsAll(getClientAppointments(client));
      return;
    }
    try {
      setClientDetailsAppointmentsLoading(true);
      setClientDetailsAppointmentsError(null);
      const phoneParam = encodeURIComponent(normalizedPhone);
      const res = clientId
          ? await api.get(`/admin/clients/${encodeURIComponent(clientId)}/appointments?future=true`)
          : await api.get(`/clients/me/appointments?phone=${phoneParam}`);
      const rows = Array.isArray(res) ? res : (res?.data ?? []);
      const normalizedRows = normalizeAppointmentRows(rows || []);
      setClientDetailsAppointmentsAll(filterAppointmentsForClient(normalizedRows, client));
    } catch (error) {
      console.error('Failed to load client appointments', error);
      setClientDetailsAppointmentsAll(normalizeAppointmentRows(getClientAppointments(client)));
      setClientDetailsAppointmentsError('לא ניתן לטעון תורים. נסה שוב.');
    } finally {
      setClientDetailsAppointmentsLoading(false);
    }
  }, [filterAppointmentsForClient, getClientAppointments, normalizeAppointmentRows]);

  useEffect(() => {
    if (clientDetailsModal?.isOpen && clientDetailsModal?.client) {
      fetchClientAppointments(clientDetailsModal.client);
      return;
    }
    setClientDetailsAppointmentsAll([]);
    setClientDetailsAppointmentsError(null);
    setClientDetailsAppointmentsLoading(false);
  }, [clientDetailsModal?.client, clientDetailsModal?.isOpen, fetchClientAppointments]);

  const clientDetailsAppointments = React.useMemo(() => {
    if (!clientDetailsModal.client) return [];
    return filterUpcomingAppointments(clientDetailsAppointmentsAll);
  }, [clientDetailsModal.client, clientDetailsAppointmentsAll, filterUpcomingAppointments]);

  const clientDetailsUpcomingCount = React.useMemo(() => {
    return filterUpcomingAppointments(clientDetailsAppointmentsAll).length;
  }, [clientDetailsAppointmentsAll, filterUpcomingAppointments]);

  const clientDetailsRecurringMeta = React.useMemo(() => {
    if (!clientDetailsModal.client) return [];
    return extractRecurringSchedules(clientDetailsModal.client)
        .map((recurring) => describeRecurringSchedule(recurring, clientDetailsModal.client.id))
        .filter(Boolean);
  }, [clientDetailsModal.client]);

  const filteredClients = useMemo(() => {
    const term = clientSearchTerm.trim().toLowerCase();
    return clientDataWithAppointments.filter((client) => {
      const memberFlag = Boolean(client.isMember ?? client.is_member);
      if (showMembersOnlyClients && !memberFlag) return false;
      if (!term) return true;
      const nameParts = [
        client.first_name ?? client.firstName ?? '',
        client.last_name ?? client.lastName ?? '',
      ];
      const displayName = nameParts.filter(Boolean).join(' ').toLowerCase();
      const phoneDigits = String(client.phone ?? client.client_phone ?? '')
          .replace(/\D/g, '');
      return displayName.includes(term) || phoneDigits.includes(term);
    });
  }, [clientDataWithAppointments, clientSearchTerm, showMembersOnlyClients]);

  const businessHoursByDay = useMemo(() => {
    const arr = Array.from({ length: 7 }, () => null);
    (businessHours || []).forEach((row) => {
      const normalized = normalizeBusinessHourRow(row);
      if (normalized && Number.isInteger(normalized.weekday)) {
        arr[normalized.weekday] = normalized;
      }
    });
    return arr;
  }, [businessHours]);

  const stepMinutesByDay = useMemo(() => (
    Array.from({ length: 7 }, (_, day) => {
      const base = businessHoursByDay[day] || DEFAULT_MEMBER_DAY_HOURS.find((h) => h.weekday === day);
      return Number(base?.slotMinutes ?? base?.slot ?? 30) || 30;
    })
  ), [businessHoursByDay]);

  const memberSlotsByDay = useMemo(() => (
    memberWindowsByDay.map((windows, day) => expandWindowsToSlots(windows, stepMinutesByDay[day] || 30))
  ), [memberWindowsByDay, stepMinutesByDay]);

  const possibleSlotsByDay = useMemo(() => (
    Array.from({ length: 7 }, (_, day) => {
      const step = stepMinutesByDay[day] || 30;
      const ranges = [];
      const businessRange = businessHoursByDay[day];
      if (businessRange?.open && businessRange?.close && businessRange?.isOpen !== false) {
        ranges.push({ start: businessRange.open, end: businessRange.close });
      } else {
        const fallback = DEFAULT_MEMBER_DAY_HOURS.find((h) => h.weekday === day);
        if (fallback?.open && fallback?.close) {
          ranges.push({ start: fallback.open, end: fallback.close });
        }
      }
      const windows = memberWindowsByDay[day] || [];
      windows.forEach((win) => ranges.push({ start: win.start, end: win.end }));
      return buildSlotsFromRanges(ranges, step);
    })
  ), [businessHoursByDay, memberWindowsByDay, stepMinutesByDay]);

  const toggleMemberSlot = React.useCallback((weekday, time) => {
    const step = stepMinutesByDay[weekday] || 30;
    setMemberSettings((prev) => {
      const existingForDay = (prev.memberOnlyWindows || []).filter((win) => Number(win.weekday) === Number(weekday));
      const currentSlots = expandWindowsToSlots(existingForDay, step);
      const slotSet = new Set(currentSlots);
      if (slotSet.has(time)) {
        slotSet.delete(time);
      } else {
        slotSet.add(time);
      }
      const sortedSlots = Array.from(slotSet).sort((a, b) => toMinutes(a) - toMinutes(b));
      const updatedWindowsForDay = slotsToWindows(sortedSlots, step).map((win, index) => ({
        weekday,
        start: win.start,
        end: win.end,
        id: `${weekday}-${win.start}-${win.end}-${index}`,
      }));
      const others = (prev.memberOnlyWindows || []).filter((win) => Number(win.weekday) !== Number(weekday));
      return {
        ...prev,
        memberOnlyWindows: [...others, ...updatedWindowsForDay],
      };
    });
    setMemberSettingsDirty(true);
    setMemberSettingsFeedback(null);
  }, [setMemberSettingsDirty, setMemberSettingsFeedback, stepMinutesByDay]);

  const clearMemberSlots = React.useCallback((weekday) => {
    setMemberSettings((prev) => ({
      ...prev,
      memberOnlyWindows: (prev.memberOnlyWindows || []).filter((win) => Number(win.weekday) !== Number(weekday)),
    }));
    setMemberSettingsDirty(true);
    setMemberSettingsFeedback(null);
  }, [setMemberSettingsDirty, setMemberSettingsFeedback]);

  const blocksForSelectedDay = useMemo(() => {
    return (blocks || []).filter((b) => {
      const s = new Date(b.start_at || b.startAt || b.startsAt);
      return !Number.isNaN(s.getTime()) && isSameDay(s, selectedDate);
    }).sort((a,b) => new Date(a.start_at || a.startAt || a.startsAt) - new Date(b.start_at || b.startAt || b.startsAt));
  }, [blocks, selectedDate]);


  // אם אין עדיין אישור אדמין מהguard, אפשר להחזיר null/ספינר קצר
  const handleUpdatesTouchStart = (event) => {
    updatesTouchStartYRef.current = event.touches?.[0]?.clientY ?? 0;
    updatesDidTriggerRef.current = false;
  };

  const handleUpdatesTouchMove = (event) => {
    const container = updatesListRef.current;
    if (!container) return;
    const currentY = event.touches?.[0]?.clientY ?? 0;
    const delta = currentY - updatesTouchStartYRef.current;
    if (container.scrollTop <= 0 && delta > 0 && !isRefreshingUpdates) {
      setUpdatesPullDistance(Math.min(delta, 90));
    }
  };

  const handleUpdatesTouchEnd = async () => {
    if (updatesPullDistance >= 70 && !isRefreshingUpdates && !updatesDidTriggerRef.current) {
      updatesDidTriggerRef.current = true;
      await loadAdminUpdates({ withSpinner: true });
      return;
    }
    setUpdatesPullDistance(0);
  };

  const getBookingSummary = (item) => {
    if (item?.type !== 'booking') return null;
    const startsAtRaw = item?.appointment?.startsAt || item?.startsAt;
    const startsAtDate = startsAtRaw ? new Date(startsAtRaw) : null;
    const hasDate = startsAtDate && !Number.isNaN(startsAtDate.getTime());
    const serviceName = item?.appointment?.serviceName || item?.serviceName || 'לא צוין';
    return {
      serviceName,
      dayLabel: hasDate ? format(startsAtDate, 'EEEE dd/MM/yyyy', { locale: he }) : 'לא צוין',
      timeLabel: hasDate ? format(startsAtDate, 'HH:mm') : 'לא צוין',
    };
  };

  const getUpdateHeadline = (item) => {
    if (item?.type === 'booking') {
      const explicitName = String(item?.clientName || '').trim();
      if (explicitName) return `${explicitName} קבע תור`;
      const fromMsg = String(item?.message || '').replace(/\s*\(.*\)\s*$/, '').trim();
      return fromMsg || 'לקוח קבע תור';
    }
    return item?.message || 'עדכון';
  };

  if (!canAccessAdmin) {
    return null; // או ספינר קל אם תרצה
  }

// תמיד דורשים קוד — גם לאדמין — עד שיאומת
  if (!isCodeVerified) {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 overflow-hidden" dir="rtl">
          <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="bg-white rounded-3xl p-8 shadow-lg max-w-md mx-auto w-full"
          >
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-gray-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">כניסת מנהל</h2>
              <p className="text-gray-600">הזן את קוד המנהל כדי להמשיך</p>
            </div>

            <form className="space-y-4" onSubmit={handleAdminCodeSubmit}>
              <Input
                  type="password"
                  placeholder="קוד מנהל"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  className="text-center text-lg tracking-widest"
                  autoFocus
              />

              {authError && (
                  <Alert className="border-red-200 bg-red-50">
                    <AlertDescription className="text-red-700 text-center">
                      {authError}
                    </AlertDescription>
                  </Alert>
              )}

              <Button
                  type="submit"
                  className="w-full bg-black text-white hover:bg-gray-800 rounded-full py-3 font-medium"
              >
                כניסה
              </Button>
            </form>
          </motion.div>
        </div>
    );
  }

  if (loading) {
    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center" dir="rtl">
          <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="text-white flex flex-col items-center space-y-4"
          >
            <svg
                className="animate-spin h-16 w-16 text-blue-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
            >
              <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
              ></circle>
              <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <p className="text-xl font-semibold">טוען נתונים...</p>
          </motion.div>
        </div>
    );
  }


  return (
      <div className="min-h-screen bg-gray-100 flex" dir="rtl" style={{ paddingTop: '80px' }}>
        <div className={`fixed inset-y-0 right-0 z-40 w-64 bg-white shadow-lg transform ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`} style={{ top: '80px' }}>
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-2xl font-bold text-gray-800">פאנל ניהול</h2>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
          <nav className="flex-1 p-4 space-y-2">
            {navItems.map(item => (
                <Button
                    key={item.id}
                    variant="ghost"
                    className={`w-full justify-start text-lg gap-3 py-3 hover:bg-transparent focus:bg-transparent active:bg-transparent ${activeTab === item.id ? "font-semibold text-gray-900 bg-transparent" : "text-gray-700"}`}
                    onClick={() => {
                      setActiveTab(item.id);
                      setShowWaitingListView(false);
                      setSidebarOpen(false);
                    }}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </Button>
            ))}
          </nav>
          <div className="p-4 mt-auto border-t">
            <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="w-full justify-start text-gray-500 hover:text-gray-700"
            >
              <LogOut className="w-4 h-4 ml-2" />
              התנתקות
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-6">
            <AnimatePresence mode="wait">
              <motion.div
                  key={showWaitingListView ? 'waitingList' : activeTab}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
              >
                {showWaitingListView && (
                    <div className="space-y-6 relative">
                      <div className="flex items-center gap-3 mb-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowWaitingListView(false)}
                            className="rounded-full"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </Button>
                        <h2 className="text-2xl font-bold text-gray-800">רשימת המתנה</h2>
                      </div>

                      <div className="mb-4">
                        <h3 className="text-lg font-bold text-gray-800 mb-3 px-1">בחר יום</h3>
                        <div ref={dayStripRef1} dir="rtl"
                             className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide snap-x snap-mandatory scroll-smooth">
                          {daysForPicker.map((day, index) => {
                            const isSelected = isSameDay(day, selectedDate);
                            return (
                                <div key={index} data-day-index={index} className="flex-shrink-0 snap-center">
                                  <button
                                      onClick={() => setSelectedDate(day)}
                                      className={`flex flex-col items-center justify-center w-14 h-16 rounded-2xl transition-all duration-200 ${
                                          isSelected ? 'bg-black text-white shadow-md' : 'bg-white text-gray-700'
                                      }`}
                                  >
                                    <span className="text-xs font-medium">{format(day, 'E', { locale: he })}</span>
                                    <span className="text-lg font-bold">{format(day, 'd')}</span>
                                  </button>
                                </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {Object.keys(waitingListGroups).length > 0 ? (
                            Object.entries(waitingListGroups).map(([time, entries]) => {
                              const isExpanded = expandedWaitingTimes.has(time);
                              const hasMultiple = entries.length > 1;

                              return (
                                  <div key={time} className="space-y-2">
                                    <div className="flex items-center justify-between px-2">
                                      <div className="text-sm font-semibold text-gray-700">{time}</div>
                                      {hasMultiple && (
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => toggleWaitingTimeGroup(time)}
                                              className="text-xs text-gray-600"
                                          >
                                            {isExpanded ? 'סגור רשימה' : `הצג ${entries.length}`}
                                          </Button>
                                      )}
                                    </div>

                                    {!hasMultiple || isExpanded ? (
                                        entries.map(entry => {
                                          const service = services.find(s => s.id === entry.service_id);
                                          const isMember = Boolean(entry.is_club_member ?? entry.isClubMember);
                                          return (
                                              <motion.div
                                                  key={entry.id}
                                                  initial={{ opacity: 0, y: 20 }}
                                                  animate={{ opacity: 1, y: 0 }}
                                                  exit={{ opacity: 0 }}
                                                  onClick={() => setSelectedWaitingEntry(entry)}
                                                  className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3 cursor-pointer transition-colors duration-200 hover:bg-gray-50"
                                              >
                                                <div className="text-center w-20">
                                                  <p className="font-bold text-gray-900 text-sm">{time}</p>
                                                </div>
                                                <div className="w-px bg-gray-200 h-10 self-center mx-1"></div>
                                                <div className="flex-1">
                                                  <h4 className="font-bold text-gray-900">
                                                    {entry.client_name}
                                                  </h4>
                                                  <div className="flex items-center gap-2">
                                                    <p className="text-sm text-gray-600">{service?.name || 'שירות לא ידוע'}</p>
                                                    {isMember && (
                                                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                                          חבר מועדון
                                                        </span>
                                                    )}
                                                  </div>
                                                  {entry.phone && (
                                                      <p className="text-xs text-gray-500">{entry.phone}</p>
                                                  )}
                                                </div>
                                                <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-700" onClick={(e) => { e.stopPropagation(); setSelectedWaitingEntry(entry); }}>
                                                  <MoreVertical className="w-5 h-5" />
                                                </Button>
                                              </motion.div>
                                          );
                                        })
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => toggleWaitingTimeGroup(time)}
                                            className="w-full bg-white rounded-2xl p-3 shadow-sm flex items-center justify-between transition-colors duration-200 hover:bg-gray-50"
                                        >
                                          <div className="text-sm text-gray-700">
                                            יש {entries.length} לקוחות לשעה זו
                                          </div>
                                          <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                                            {entries.length}
                                          </span>
                                        </button>
                                    )}
                                  </div>
                              );
                            })
                        ) : (
                            <div className="text-center py-16 bg-white rounded-2xl shadow-sm">
                              <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                              <h4 className="text-lg font-semibold text-gray-700">אין לקוחות ברשימת המתנה להיום</h4>
                              <p className="text-gray-500 text-sm">נראה שהכל פנוי :)</p>
                            </div>
                        )}
                      </div>
                    </div>
                )}

                {!showWaitingListView && activeTab === 'appointments' && (
                    <div className="space-y-6 relative">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <h2 className="text-2xl font-bold text-gray-800">ניהול תורים</h2>
                        <div className="inline-flex items-center rounded-xl bg-gray-100 p-1">
                          <Button
                              type="button"
                              size="sm"
                              variant={appointmentsViewMode === 'list' ? 'default' : 'ghost'}
                              className="gap-1.5"
                              onClick={() => setAppointmentsViewMode('list')}
                          >
                            <List className="w-4 h-4" />
                            רשימה
                          </Button>
                          <Button
                              type="button"
                              size="sm"
                              variant={appointmentsViewMode === 'calendar' ? 'default' : 'ghost'}
                              className="gap-1.5"
                              onClick={() => setAppointmentsViewMode('calendar')}
                          >
                            <LayoutGrid className="w-4 h-4" />
                            יומן שבועי
                          </Button>
                        </div>
                      </div>

                      {appointmentsViewMode === 'list' && (
                        <div className="mb-4">
                          <h3 className="text-lg font-bold text-gray-800 mb-3 px-1">בחר יום</h3>
                          <div ref={dayStripRef2} dir="rtl"
                               className="flex overflow-x-auto gap-3 pb-2 scrollbar-hide snap-x snap-mandatory scroll-smooth">

                            {daysForPicker.map((day, index) => {
                              const isSelected = isSameDay(day, selectedDate);
                              const isSaturday = day.getDay() === 6;
                              return (
                                  <div key={index} data-day-index={index} className="flex-shrink-0 snap-center">
                                    <button
                                        onClick={() => !isSaturday && setSelectedDate(day)}
                                        disabled={isSaturday}
                                        aria-disabled={isSaturday}
                                        title={isSaturday ? "שבת - אין תורים" : ""}
                                        className={`flex flex-col items-center justify-center w-14 h-16 rounded-2xl transition-all duration-200 ${
                                            isSaturday
                                                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                                : (isSelected ? 'bg-black text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-50')
                                        }`}
                                    >

                                      <span className="text-xs font-medium">{format(day, 'E', {locale: he})}</span>
                                      <span className="text-lg font-bold">{format(day, 'd')}</span>
                                    </button>
                                  </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {appointmentsViewMode === 'list' ? (
                        <>
                          <div className="space-y-3">
                            {getAppointmentsForDay(selectedDate).length > 0 ? (
                                getAppointmentsForDay(selectedDate).map(apt => {
                                  const service = serviceById(apt.service_id)
                                  const isCompleted = apt.status === 'completed';
                                  const isBlocked = apt.status === 'blocked';
                                  const passed = isAfter(new Date(), new Date(apt.ends_at));
                                  const displayInfo = getAppointmentDisplayInfo(apt);
                                  const displayName = isBlocked ? 'חסום' : displayInfo.name;
                                  const selectedData = {
                                    ...apt,
                                    client_name: displayName,
                                    clientName: displayName,
                                    client_phone: isBlocked ? '' : displayInfo.phone,
                                    client: displayInfo.client || apt.client,
                                  };
                                  return (
                                      <motion.div
                                          key={apt.id}
                                          initial={{ opacity: 0, y: 20 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          exit={{ opacity: 0 }}
                                          onClick={() =>
                                              setSelectedAppointment(selectedData)
                                          }
                                          className={`bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3 cursor-pointer transition-colors duration-200 hover:bg-gray-50${isBlocked ? 'bg-gray-200 opacity-80' : ''}${isCompleted ? 'opacity-60' : ''}${passed ? 'border border-green-300' : 'border border-gray-200'}`}
                                      >
                                        <div className="text-center w-20">
                                          <p className={`font-bold text-gray-900 text-sm ${isCompleted || isBlocked ? 'line-through' : ''}`}>
                                            {format(new Date(apt.starts_at), 'HH:mm')}
                                          </p>
                                          <p className="text-xs text-gray-500">עד</p>
                                          <p className={`font-bold text-gray-900 text-sm ${isCompleted || isBlocked ? 'line-through' : ''}`}>
                                            {format(new Date(apt.ends_at), 'HH:mm')}
                                          </p>
                                        </div>
                                        <div className="w-px bg-gray-200 h-10 self-center mx-1"></div>
                                        <div className="flex-1">
                                          <h4 className={`font-bold text-gray-900 ${isCompleted || isBlocked ? 'line-through' : ''}`}>
                                            {displayName}
                                          </h4>
                                          <p className="text-sm text-gray-600">{serviceName({...apt, service})}</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-700"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedAppointment(selectedData);
                                                }}>
                                          <MoreVertical className="w-5 h-5" />
                                        </Button>
                                      </motion.div>
                                  );
                                })
                            ) : (
                                <div className="text-center py-16 bg-white rounded-2xl shadow-sm">
                                  <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                  <h4 className="text-lg font-semibold text-gray-700">אין תורים להיום</h4>
                                  <p className="text-gray-500 text-sm">אפשר לקחת יום חופש :)</p>
                                </div>
                            )}
                          </div>

                          {blocksForSelectedDay.length > 0 && (
                              <div className="mt-4">
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="text-sm font-semibold text-gray-800">חסימות פעילות</h4>
                                  <Button variant="outline" size="sm" onClick={reloadBlocks}>רענון</Button>
                                </div>

                                <div className="space-y-2">
                                  {blocksForSelectedDay.map((blk) => {
                                    const s = new Date(blk.start_at || blk.startAt || blk.startsAt);
                                    const e = new Date(blk.end_at || blk.endAt || blk.endsAt);
                                    const reason = blk.reason || "";
                                    return (
                                        <div
                                            key={blk.id}
                                            className="flex items-center justify-between bg-white rounded-2xl px-3 py-2 shadow-sm border"
                                        >
                                          <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100">
                    <Ban className="w-3.5 h-3.5 text-red-600" />
                  </span>
                                            <div className="text-xs">
                                              <div className="font-semibold text-gray-900">
                                                {format(s, "HH:mm")} – {format(e, "HH:mm")}
                                              </div>
                                              {reason ? (
                                                  <div className="text-gray-500">{reason}</div>
                                              ) : null}
                                            </div>
                                          </div>

                                          <Button
                                              variant="outline"
                                              size="icon"
                                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                              onClick={async () => {
                                                if (!confirm("לבטל את החסימה הזו?")) return;
                                                try {
                                                  await AdminApi.blocks.remove(blk.id);
                                                  await reloadBlocks();
                                                } catch (err) {
                                                  console.error("failed to remove block", err);
                                                  alert("שגיאה בביטול החסימה");
                                                }
                                              }}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </Button>
                                        </div>
                                    );
                                  })}
                                </div>
                              </div>
                          )}
                        </>
                      ) : (
                        <div className="rounded-2xl bg-white border shadow-sm overflow-x-auto">
                          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: '58px repeat(6, minmax(110px, 1fr))' }}>
                            <div className="border-b border-l px-1.5 py-1.5 bg-gray-50 text-xs text-gray-500">שעה</div>
                            {weeklyCalendarDays.map((day) => (
                              <div key={day.toISOString()} className={`border-b border-l px-1 py-1.5 text-center text-xs font-semibold ${isSameDay(day, selectedDate) ? 'bg-gray-100' : 'bg-gray-50'}`}>
                                <span className="block truncate">{format(day, 'EEE', { locale: he })}</span>
                                <span className="block leading-none text-[11px]">{format(day, 'd/M')}</span>
                              </div>
                            ))}

                              {calendarTimeSlots.map((slotMinute) => (
                                <React.Fragment key={slotMinute}>
                                  <div className="border-b border-l px-1.5 py-1 text-xs text-gray-500 bg-gray-50">
                                    {toTimeString(slotMinute)}
                                  </div>
                                  {weeklyCalendarDays.map((day) => {
                                    const dayKey = format(day, 'yyyy-MM-dd');
                                    const apt = weeklyAppointments.find((item) => (
                                        format(new Date(item.starts_at), 'yyyy-MM-dd') === dayKey &&
                                        new Date(item.starts_at).getHours() * 60 + new Date(item.starts_at).getMinutes() === slotMinute
                                    ));
                                    const displayInfo = apt ? getAppointmentDisplayInfo(apt) : null;
                                    const isDraggableApt = apt ? canDragAppointmentInCalendar(apt) : false;
                                    return (
                                      <div
                                        key={`${dayKey}-${slotMinute}`}
                                        data-calendar-cell="1"
                                        data-day-date={dayKey}
                                        data-slot-minute={slotMinute}
                                        className={`border-b border-l min-h-12 p-1 ${isSameDay(day, selectedDate) ? 'bg-gray-50/60' : ''}`}
                                        onDragOver={(e) => {
                                          if (!draggedAppointmentId) return;
                                          e.preventDefault();
                                        }}
                                        onDrop={() => {
                                          if (!draggedAppointmentId) return;
                                          handleCalendarDrop(draggedAppointmentId, day, slotMinute);
                                          setDraggedAppointmentId(null);
                                        }}
                                      >
                                        {apt ? (
                                          <button
                                            type="button"
                                            draggable={isDraggableApt}
                                            onDragStart={(event) => {
                                              if (!isDraggableApt) {
                                                  return;
                                              }
                                              setDraggedAppointmentId(apt.id);
                                              startCalendarDragPreview(apt, event);
                                            }}
                                            onDrag={(event) => {
                                              if (!isDraggableApt || event.clientX <= 0 || event.clientY <= 0) return;
                                              moveCalendarDragPreview(event);
                                            }}
                                            onDragEnd={() => {
                                              setDraggedAppointmentId(null);
                                              endCalendarDragPreview();
                                            }}
                                            onTouchStart={(event) => {
                                              if (!isDraggableApt) return;
                                              setDraggedAppointmentId(apt.id);
                                              const touchPoint = event.touches?.[0];
                                              if (touchPoint) {
                                                startCalendarDragPreview(apt, touchPoint);
                                              }
                                            }}
                                            onTouchMove={(event) => {
                                              if (!isDraggableApt || !draggedAppointmentId) return;
                                              const touchPoint = event.touches?.[0];
                                              if (touchPoint) {
                                                moveCalendarDragPreview(touchPoint);
                                              }
                                            }}
                                            onTouchEnd={(event) => {
                                              if (!isDraggableApt || !draggedAppointmentId) return;
                                              const touchPoint = event.changedTouches?.[0];
                                              if (touchPoint) {
                                                handleCalendarTouchDrop(touchPoint);
                                              }
                                              setDraggedAppointmentId(null);
                                              endCalendarDragPreview();
                                            }}
                                            onTouchCancel={() => {
                                              setDraggedAppointmentId(null);
                                              endCalendarDragPreview();
                                            }}
                                            onClick={() => setSelectedAppointment({
                                              ...apt,
                                              client_name: displayInfo?.name || apt.client_name,
                                              clientName: displayInfo?.name || apt.client_name,
                                              client_phone: displayInfo?.phone || apt.client_phone,
                                              client: displayInfo?.client || apt.client,
                                            })}
                                            className={`w-full rounded-md text-right px-1.5 py-1 text-xs leading-tight shadow-sm transition ${isDraggableApt ? 'bg-black text-white hover:bg-gray-800 cursor-move touch-none' : 'bg-gray-300 text-gray-700 cursor-not-allowed'}`}
                                          >
                                            <div className="font-semibold truncate">{displayInfo?.name || 'לקוח'}</div>
                                            <div className="opacity-80 truncate text-[11px]">{format(new Date(apt.starts_at), 'HH:mm')}</div>
                                          </button>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </React.Fragment>
                              ))}
                            </div>
                          <div className="p-2 text-[11px] text-gray-500 border-t">
                            גרור תור לקובייה אחרת ואז לחץ אישור כדי לעדכן את השעה/היום.
                          </div>
                        </div>
                      )}

                      <div className="fixed bottom-24 right-6 z-30">
                        <Button
                            onClick={() => setShowQuickActionsModal(true)}
                            className="w-12 h-12 rounded-full bg-black hover:bg-gray-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                          <Plus className="w-6 h-6" />
                        </Button>
                      </div>
                    </div>
                )}

                {activeTab === 'statistics' && (
                    <div className="space-y-6">
                      <h2 className="text-2xl font-bold">סטטיסטיקות</h2>
                      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {(() => {
                          const stats = getMonthlyStats();
                          return (
                              <>
                                <Card className="bg-white rounded-2xl shadow-sm">
                                  <CardContent className="p-6 text-center">
                                    <Users className="w-12 h-12 text-blue-600 mx-auto mb-4" />
                                    <h3 className="text-2xl font-bold text-gray-900">{stats.totalClients}</h3>
                                    <p className="text-gray-600">סה"כ לקוחות</p>
                                  </CardContent>
                                </Card>

                                <Card className="bg-white rounded-2xl shadow-sm">
                                  <CardContent className="p-6 text-center">
                                    <Calendar className="w-12 h-12 text-green-600 mx-auto mb-4" />
                                    <h3 className="text-2xl font-bold text-gray-900">{stats.monthlyAppointments}</h3>
                                    <p className="text-gray-600">תורים שהושלמו החודש</p>
                                  </CardContent>
                                </Card>

                                <Card className="bg-white rounded-2xl shadow-sm">
                                  <CardContent className="p-6 text-center">
                                    <BarChart3 className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
                                    <h3 className="text-2xl font-bold text-gray-900">₪{stats.monthlyRevenue}</h3>
                                    <p className="text-gray-600">הכנסות החודש</p>
                                  </CardContent>
                                </Card>

                                <Card className="bg-white rounded-2xl shadow-sm">
                                  <CardContent className="p-6 text-center">
                                    <User className="w-12 h-12 text-purple-600 mx-auto mb-4" />
                                    <h3 className="text-2xl font-bold text-gray-900">{stats.newClientsThisMonth}</h3>
                                    <p className="text-gray-600">לקוחות חדשים החודש</p>
                                  </CardContent>
                                </Card>
                              </>
                          );
                        })()}
                      </div>
                    </div>
                )}

                {activeTab === 'clients' && (
                    <div className="relative">
                      <Card className="bg-white rounded-2xl shadow-sm">
                        <CardHeader>
                          <CardTitle>רשימת לקוחות</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                            <Input
                                placeholder="חיפוש לפי שם או טלפון"
                                value={clientSearchTerm}
                                onChange={(e) => setClientSearchTerm(e.target.value)}
                                className="md:max-w-sm"
                            />
                            <label className="flex items-center gap-2 text-sm text-gray-600">
                              <Switch
                                  checked={showMembersOnlyClients}
                                  onCheckedChange={(val) => setShowMembersOnlyClients(Boolean(val))}
                              />
                              <span>הצג רק חברי מועדון</span>
                            </label>
                          </div>
                          {filteredClients.length === 0 ? (
                              <p className="text-sm text-gray-500">לא נמצאו לקוחות תואמים.</p>
                          ) : (
                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {filteredClients.map((client) => {
                                  const memberFlag = Boolean(client.isMember ?? client.is_member);
                                  const first = client.first_name ?? client.firstName ?? (client.name?.split(' ')[0] ?? '');
                                  const last  = client.last_name  ?? client.lastName  ?? (client.name?.split(' ').slice(1).join(' ') ?? '');
                                  const phoneDisplay = client.phone ?? client.client_phone ?? '';
                                  const clientDisplayName = [first, last].filter(Boolean).join(' ').trim() || phoneDisplay || 'לקוח';
                                  const lastAppointment = client.lastAppointmentDate ? format(new Date(client.lastAppointmentDate), 'dd/MM/yyyy', { locale: he }) : 'אין היסטוריה';
                                  const lastClass = client.lastAppointmentDate
                                      ? (client.lastAppointmentRecent ? 'text-green-700' : 'text-red-700')
                                      : 'text-gray-800';
                                  const recurringList = extractRecurringSchedules(client);
                                  const recurringMeta = recurringList
                                      .map((recurring) => describeRecurringSchedule(recurring, client.id))
                                      .filter(Boolean);
                                  const primaryRecurring = recurringMeta[0] || null;
                                  return (
                                      <div
                                          key={client.id}
                                          role="button"
                                          tabIndex={0}
                                          aria-label={`פרטי ${clientDisplayName}`}
                                          onClick={() => openClientDetails(client)}
                                          onKeyDown={(event) => handleClientCardKeyDown(event, client)}
                                          className="rounded-3xl border border-gray-100 bg-white/80 p-3 sm:p-4 shadow-sm transition hover:shadow-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
                                      >
                                        <div className="flex flex-col gap-3">
                                          <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                              <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-base font-semibold text-gray-900">{clientDisplayName}</p>
                                                {memberFlag && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="flex items-center gap-1 bg-amber-100 text-amber-700"
                                                    >
                                                      <Crown className="w-3.5 h-3.5" />
                                                      <span>חבר מועדון</span>
                                                    </Badge>
                                                )}
                                                {primaryRecurring && (
                                                    <Badge
                                                        variant="outline"
                                                        className="flex items-center gap-1 border-emerald-100 bg-emerald-50 text-emerald-700"
                                                    >
                                                      <Repeat className="w-3.5 h-3.5" />
                                                      <span>{`${primaryRecurring.dayLabel}${primaryRecurring.timeLabel ? ` ${primaryRecurring.timeLabel}` : ''}`}</span>
                                                    </Badge>
                                                )}
                                              </div>
                                              <p className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                                                <Phone className="w-4 h-4 text-gray-400" />
                                                <span>{phoneDisplay || 'ללא מספר'}</span>
                                              </p>
                                            </div>
                                            <div className="text-left">
                                              <p className="text-xs text-gray-500">תור אחרון</p>
                                              <p className={`text-sm font-semibold ${lastClass}`}>{lastAppointment}</p>
                                            </div>
                                          </div>

                                          <div className="space-y-2">
                                            {recurringMeta.length > 0 ? (
                                                recurringMeta.map((item) => {
                                                  const scheduleId = item.id ?? getRecurringScheduleId(item.recurring);
                                                  const isCancelling = cancelingRecurringId === scheduleId;
                                                  return (
                                                      <div
                                                          key={item.scheduleKey}
                                                          className="rounded-2xl border border-emerald-100 bg-white/90 p-3 text-sm text-gray-700"
                                                      >
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                          <div className="flex items-center gap-2 font-semibold text-emerald-700">
                                                            <Repeat className="w-4 h-4" />
                                                            <span>{`${item.dayLabel}${item.timeLabel ? ` ${item.timeLabel}` : ''}`}</span>
                                                          </div>
                                                          <span className="text-xs text-emerald-600">{item.intervalLabel}</span>
                                                        </div>
                                                        {item.serviceLabel && (
                                                            <p className="mt-1 text-xs text-gray-500">{item.serviceLabel}</p>
                                                        )}
                                                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
                                                          <span>ביטול ימחוק את כל התורים העתידיים</span>
                                                          <Button
                                                              variant="ghost"
                                                              size="sm"
                                                              className="text-red-600 hover:text-red-700 px-2 py-1"
                                                              onClick={(event) => {
                                                                event.stopPropagation();
                                                                startRecurringCancelFlow(item, clientDisplayName);
                                                              }}
                                                              disabled={isCancelling}
                                                          >
                                                            {isCancelling ? 'מבטל…' : 'בטל תור קבוע'}
                                                          </Button>
                                                        </div>
                                                      </div>
                                                  );
                                                })
                                            ) : (
                                                <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-gray-300 bg-white/70 px-3 py-1 text-xs text-gray-500 w-fit">
                                                  <Repeat className="w-3 h-3 text-gray-400" />
                                                  <span>אין תור קבוע ללקוח זה</span>
                                                </div>
                                            )}
                                          </div>

                                          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
                                            <p className="text-xs text-gray-600">
                                              {memberFlag ? 'הלקוח חבר במועדון' : 'הלקוח אינו חבר מועדון'}
                                            </p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  toggleClientMembership(client);
                                                }}
                                                className={memberFlag ? 'border-emerald-600 text-emerald-700 hover:bg-emerald-50' : ''}
                                            >
                                              {memberFlag ? 'הסר ממועדון' : 'הפוך לחבר'}
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                  );
                                })}
                              </div>
                          )}
                        </CardContent>
                      </Card>
                      <div className="fixed bottom-24 right-6 z-30">
                        <Button
                            onClick={() => setShowQuickActionsModal(true)}
                            className="w-12 h-12 rounded-full bg-black hover:bg-gray-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                          <Plus className="w-6 h-6" />
                        </Button>
                      </div>
                    </div>
                )}


                {activeTab === 'updates' && (
                    <div className="space-y-6">
                      <Card className="bg-white rounded-2xl shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle>עדכוני לקוחות</CardTitle>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleClearAdminUpdates}
                              disabled={isRefreshingUpdates || isClearingUpdates || adminUpdates.length === 0}
                            >
                              {isClearingUpdates ? 'מוחק…' : 'נקה הכל'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => loadAdminUpdates({ withSpinner: true })} disabled={isRefreshingUpdates || isClearingUpdates} className="gap-1.5">
                              {isRefreshingUpdates && <Loader2 className="w-4 h-4 animate-spin" />}
                              {isRefreshingUpdates ? 'מרענן…' : 'רענון'}
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div
                            ref={updatesListRef}
                            className="max-h-[65vh] overflow-y-auto space-y-2 pr-1"
                            onTouchStart={handleUpdatesTouchStart}
                            onTouchMove={handleUpdatesTouchMove}
                            onTouchEnd={handleUpdatesTouchEnd}
                          >
                            <div className="text-center text-xs text-gray-400 py-1">{isRefreshingUpdates ? 'טוען עדכונים…' : (updatesPullDistance >= 70 ? 'שחרר כדי לרענן' : 'גלול למעלה ומשוך לרענון')}</div>
                            {isRefreshingUpdates && (
                              <div className="flex items-center justify-center gap-2 text-xs text-gray-500 pb-1"> 
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>מתבצע רענון</span>
                              </div>
                            )}
                            {adminUpdates.length === 0 ? (
                                <p className="text-sm text-gray-500">אין עדכונים להצגה כרגע.</p>
                            ) : (
                                adminUpdates.map((item, idx) => {
                                  const colorClass = item?.color === 'green'
                                      ? 'text-green-700'
                                      : item?.color === 'red'
                                        ? 'text-red-700'
                                        : 'text-gray-800';
                                  const booking = getBookingSummary(item);
                                  const eventDate = item?.createdAt ? new Date(item.createdAt) : null;
                                  const eventTimeLabel = eventDate && !Number.isNaN(eventDate.getTime())
                                    ? format(eventDate, 'HH:mm dd/MM/yyyy')
                                    : '';
                                  return (
                                      <div key={`${item?.createdAt || 'update'}-${idx}`} className="border border-gray-200 rounded-xl px-3 py-2">
                                        <p className={`font-medium ${colorClass}`}>{getUpdateHeadline(item)}</p>
                                        {booking && (
                                          <p className="text-xs text-gray-500 mt-1">{booking.serviceName} · {booking.dayLabel} · {booking.timeLabel}</p>
                                        )}
                                        <p className="text-xs text-gray-400 mt-1">{eventTimeLabel}</p>
                                      </div>
                                  );
                                })
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                )}

                {activeTab === 'business-hours' && (
                    <div className="space-y-6">
                      <Card className="bg-white rounded-2xl shadow-sm">
                        <CardHeader>
                          <CardTitle>שעות פעילות</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-gray-600 mb-4">
                            קבע את שעות הפתיחה והסגירה לכל יום בשבוע. הלקוחות יוכלו להזמין תורים רק במסגרת שעות הפעילות.
                          </p>
                          {businessHoursDraft.length === 0 ? (
                              <p className="text-sm text-gray-500">טוען נתוני שעות פעילות…</p>
                          ) : (
                              <div className="space-y-4">
                                {businessHoursDraft.map((row) => {
                                  const label = WEEKDAY_LABELS[row.weekday];
                                  return (
                                      <div key={row.weekday} className="border border-gray-200 rounded-2xl p-4 space-y-4">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                          <div className="flex items-center gap-2">
                                            <h4 className="text-base font-semibold text-gray-900">{label}</h4>
                                            {!row.isOpen && (
                                                <Badge variant="secondary" className="bg-gray-200 text-gray-700">
                                                  סגור
                                                </Badge>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-500">פתוח?</span>
                                            <Switch
                                                checked={row.isOpen}
                                                onCheckedChange={(val) => handleBusinessDayToggle(row.weekday, val)}
                                            />
                                          </div>
                                        </div>

                                        <div className="grid gap-3 sm:grid-cols-3">
                                          <div>
                                            <Label className="text-xs text-gray-500 mb-1">שעת פתיחה</Label>
                                            <Input
                                                type="time"
                                                value={row.open || ""}
                                                disabled={!row.isOpen}
                                                onChange={(e) => handleBusinessTimeChange(row.weekday, 'open', e.target.value)}
                                            />
                                          </div>
                                          <div>
                                            <Label className="text-xs text-gray-500 mb-1">שעת סגירה</Label>
                                            <Input
                                                type="time"
                                                value={row.close || ""}
                                                disabled={!row.isOpen}
                                                onChange={(e) => handleBusinessTimeChange(row.weekday, 'close', e.target.value)}
                                            />
                                          </div>
                                          <div>
                                            <Label className="text-xs text-gray-500 mb-1">מרווחי תורים (בדקות)</Label>
                                            <Input
                                                type="number"
                                                min={5}
                                                max={180}
                                                step={5}
                                                value={row.slotIntervalMinutes}
                                                onChange={(e) => handleBusinessIntervalChange(row.weekday, e.target.value)}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                  );
                                })}
                              </div>
                          )}
                        </CardContent>
                        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          {businessHoursFeedback && (
                              <Alert
                                  className={businessHoursFeedback.type === 'error'
                                      ? 'border-red-200 bg-red-50'
                                      : 'border-emerald-200 bg-emerald-50'}
                              >
                                <AlertDescription
                                    className={businessHoursFeedback.type === 'error'
                                        ? 'text-red-700'
                                        : 'text-emerald-700'}
                                >
                                  {businessHoursFeedback.message}
                                </AlertDescription>
                              </Alert>
                          )}
                          <Button
                              onClick={handleSaveBusinessHours}
                              disabled={!businessHoursDirty || businessHoursSaving}
                              className="rounded-full px-6"
                          >
                            {businessHoursSaving ? 'שומר…' : 'שמירת שעות הפעילות'}
                          </Button>
                        </CardFooter>
                      </Card>
                    </div>
                )}

                {activeTab === 'member-settings' && (
                    <div className="space-y-6">
                      <Card className="bg-white rounded-2xl shadow-sm">
                        <CardHeader>
                          <CardTitle>הגדרת טווח הזמנות</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <Label className="text-sm font-semibold text-gray-800">לקוחות רגילים</Label>
                              <Input
                                  type="number"
                                  min={0}
                                  max={365}
                                  value={memberSettings.publicMaxAdvanceDays}
                                  onChange={(e) => handlePublicAdvanceChange(e.target.value)}
                                  className="mt-2"
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                מספר הימים קדימה שלקוח שאינו חבר מועדון יכול להזמין.
                              </p>
                            </div>
                            <div>
                              <Label className="text-sm font-semibold text-gray-800">חברי מועדון</Label>
                              <Input
                                  type="number"
                                  min={0}
                                  max={365}
                                  value={memberSettings.memberMaxAdvanceDays}
                                  onChange={(e) => handleMemberAdvanceChange(e.target.value)}
                                  className="mt-2"
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                מספר הימים קדימה שחבר מועדון יכול להזמין תור.
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="bg-white rounded-2xl shadow-sm">
                        <CardHeader>
                          <CardTitle>שירותים בלעדיים לחברי מועדון</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-gray-600 mb-4">
                            בחר אילו שירותים זמינים רק לחברי מועדון. לקוחות רגילים לא יראו אפשרות להזמין אותם.
                          </p>
                          <div className="space-y-3">
                            {services.length === 0 ? (
                                <p className="text-sm text-gray-500">אין שירותים להצגה כרגע.</p>
                            ) : (
                                services.map((service) => {
                                  const idStr = String(service.id ?? "");
                                  const checked = memberOnlyServiceSet.has(idStr);
                                  return (
                                      <div
                                          key={service.id}
                                          className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3"
                                      >
                                        <div>
                                          <p className="font-semibold text-gray-900">{service.name}</p>
                                          <p className="text-xs text-gray-500">
                                            {service.duration_minutes ?? service.durationMinutes} דקות · ₪{service.price}
                                          </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-gray-500">{checked ? 'חברי מועדון בלבד' : 'פתוח לכולם'}</span>
                                          <Switch checked={checked} onCheckedChange={(val) => toggleMemberOnlyService(service.id, val)} />
                                        </div>
                                      </div>
                                  );
                                })
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="bg-white rounded-2xl shadow-sm">
                        <CardHeader>
                          <CardTitle>שעות בלעדיות לחברי מועדון</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-gray-600 mb-4">
                            קבע חלונות זמן בכל יום שיופיעו רק לחברי מועדון. לקוחות רגילים לא יראו את השעות האלו.
                          </p>
                          <div className="space-y-6">
                            {MEMBER_SLOT_WEEKDAYS.map((label, idx) => {
                              const slots = memberSlotsByDay[idx] || [];
                              const options = possibleSlotsByDay[idx] || [];
                              const hasSelection = slots.length > 0;
                              return (
                                  <div key={label} className="space-y-2">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                      <h4 className="font-semibold text-gray-900">{label}</h4>
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => clearMemberSlots(idx)}
                                          disabled={!hasSelection}
                                          className="text-gray-500 hover:text-gray-800"
                                      >
                                        נקה הכל
                                      </Button>
                                    </div>
                                    {options.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                          {options.map((time) => {
                                            const selected = slots.includes(time);
                                            return (
                                                <button
                                                    key={`${label}-${time}`}
                                                    type="button"
                                                    onClick={() => toggleMemberSlot(idx, time)}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${selected
                                                        ? 'bg-emerald-600 text-white shadow-sm'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                                >
                                                  {time}
                                                </button>
                                            );
                                          })}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500">אין שעות זמינות להצגה ליום זה.</p>
                                    )}
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium text-gray-500">שעות לחברי מועדון בלבד:</p>
                                      {hasSelection ? (
                                          <div className="flex flex-wrap gap-2">
                                            {slots.map((time) => (
                                                <span
                                                    key={`${label}-member-${time}`}
                                                    className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1"
                                                >
                                                  {time}
                                                </span>
                                            ))}
                                          </div>
                                      ) : (
                                          <p className="text-xs text-gray-400">אין שעות בלעדיות שנקבעו.</p>
                                      )}
                                    </div>
                                  </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        {memberSettingsFeedback && (
                            <Alert
                                className={memberSettingsFeedback.type === 'error'
                                    ? 'border-red-200 bg-red-50'
                                    : 'border-emerald-200 bg-emerald-50'}
                            >
                              <AlertDescription
                                  className={memberSettingsFeedback.type === 'error'
                                      ? 'text-red-700'
                                      : 'text-emerald-700'}
                              >
                                {memberSettingsFeedback.message}
                              </AlertDescription>
                            </Alert>
                        )}
                        <div className="flex items-center gap-3 sm:ml-auto">
                          {memberSettingsDirty && !memberSettingsSaving && (
                              <span className="text-xs text-gray-500">יש שינויים שלא נשמרו</span>
                          )}
                          <Button
                              onClick={handleSaveMemberSettings}
                              disabled={!memberSettingsDirty || memberSettingsSaving}
                              className="rounded-full bg-black text-white hover:bg-gray-800"
                          >
                            {memberSettingsSaving ? 'שומר…' : 'שמירת הגדרות'}
                          </Button>
                        </div>
                      </div>
                    </div>
                )}

                {activeTab === 'services' && (
                    <div className="space-y-6">
                      <div className="flex justify-end">
                        <Button
                            onClick={() => setShowServiceForm(true)}
                            className="w-10 h-10 rounded-full bg-black hover:bg-gray-800 text-white shadow-md"
                            size="icon"
                        >
                          <Plus className="w-5 h-5" />
                        </Button>
                      </div>

                      <DragDropContext onDragEnd={(result) => handleDragEnd(result, services, setServices, Service)}>
                        <Droppable droppableId="services">
                          {(provided) => (
                              <div
                                  {...provided.droppableProps}
                                  ref={provided.innerRef}
                                  className="grid md:grid-cols-2 lg:grid-cols-3 gap-4"
                              >
                                {services.map((service, index) => {
                                  const isActive = service.isActive ?? service.is_active ?? true;
                                  const durationValue = service.durationMinutes ?? service.duration_minutes ?? service.duration;
                                  const durationLabel = durationValue ? `${durationValue} דקות` : "משך לא מוגדר";

                                  return (
                                    <Draggable key={service.id} draggableId={service.id.toString()} index={index}>
                                      {(provided) => (
                                          <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                          >
                                            <Card className="rounded-2xl border border-gray-200/70 bg-white shadow-sm transition hover:shadow-md">
                                              <CardContent className="p-5 space-y-4">
                                                <div className="flex justify-between items-start gap-3">
                                                  <div className="flex items-center gap-3">
                                                    <div {...provided.dragHandleProps} className="cursor-grab text-gray-400 hover:text-gray-600">
                                                      <GripVertical />
                                                    </div>
                                                    <div>
                                                      <h3 className="font-bold text-lg text-gray-900">{service.name}</h3>
                                                      <p className="text-xs text-gray-500">{service.description || "ללא תיאור"}</p>
                                                    </div>
                                                  </div>
                                                  <Badge className={isActive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                                                    {isActive ? "פעיל" : "לא פעיל"}
                                                  </Badge>
                                                </div>

                                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                                                  <span className="font-semibold text-gray-900">₪{service.price}</span>
                                                  <span className="flex items-center gap-1 text-gray-600">
                                                    <Clock className="h-4 w-4 text-gray-400" />
                                                    {durationLabel}
                                                  </span>
                                                </div>

                                                <div className="flex gap-2">
                                                  <Button
                                                      variant="outline"
                                                      size="sm"
                                                      onClick={() => {
                                                        setEditingService(service);
                                                        setShowServiceForm(true);
                                                      }}
                                                      className="flex-1"
                                                  >
                                                    <Edit className="w-4 h-4 mr-1" />
                                                    עריכה
                                                  </Button>
                                                  <Button
                                                      variant="outline"
                                                      size="sm"
                                                      onClick={() => handleDelete(Service, service.id, "שירות")}
                                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                  >
                                                    <Trash2 className="w-4 h-4" />
                                                  </Button>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          </div>
                                      )}
                                    </Draggable>
                                  );
                                })}
                                {provided.placeholder}
                              </div>
                          )}
                        </Droppable>
                      </DragDropContext>
                    </div>
                )}

                {activeTab === 'products' && (
                    <div className="space-y-6">
                      <div className="flex justify-end">
                        <Button
                            onClick={() => { setEditingProduct(null); setShowProductForm(true); }}
                            className="w-10 h-10 rounded-full bg-black hover:bg-gray-800 text-white shadow-md"
                            size="icon"
                        >
                          <Plus className="w-5 h-5" />
                        </Button>
                      </div>
                      <DragDropContext onDragEnd={(result) => handleDragEnd(result, products, setProducts, Product)}>
                        <Droppable droppableId="products">
                          {(provided) => (
                              <div
                                  {...provided.droppableProps}
                                  ref={provided.innerRef}
                                  className="grid md:grid-cols-2 lg:grid-cols-4 gap-4"
                              >
                                {products.map((product, index) => (
                                    <Draggable key={product.id} draggableId={product.id.toString()} index={index}>
                                      {(provided) => (
                                          <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                          >
                                            <Card className="bg-white rounded-2xl shadow-sm">
                                              <CardContent className="p-4">
                                                <div
                                                    className="flex items-center justify-start gap-2 mb-2" {...provided.dragHandleProps}>
                                                  <GripVertical className="cursor-grab text-gray-400"/>
                                                </div>
                                                <img
                                                    src={
                                                      product.image_url && !product.image_url.includes('via.placeholder.com')
                                                          ? product.image_url
                                                          : `https://placehold.co/600x400?text=${encodeURIComponent(product.name || 'Product')}`
                                                    }
                                                    onError={(e) => {
                                                      e.currentTarget.onerror = null;
                                                      e.currentTarget.src = `https://placehold.co/600x400?text=${encodeURIComponent(product.name || 'Product')}`;
                                                    }}
                                                    alt={product.name}
                                                    className="w-full h-40 object-cover rounded-lg mb-4"
                                                />
                                                <div className="flex justify-between items-start mb-2">
                                                  <h3 className="font-bold text-md">{product.name}</h3>
                                                  <Badge className="bg-gray-100 text-gray-800">₪{product.price}</Badge>
                                                </div>

                                                <div className="flex gap-2 mt-4">
                                                  <Button
                                                      variant="outline"
                                                      size="sm"
                                                      onClick={() => {
                                                        setEditingProduct(product);
                                                        setShowProductForm(true);
                                                      }}
                                                      className="flex-1"
                                                  >
                                                    <Edit className="w-4 h-4 mr-1"/>
                                                    עריכה
                                                  </Button>
                                                  <Button
                                                      variant="outline"
                                                      size="sm"
                                                      onClick={() => handleDelete(Product, product.id, "מוצר")}
                                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                  >
                                                    <Trash2 className="w-4 h-4"/>
                                                  </Button>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          </div>
                                      )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                              </div>
                          )}
                        </Droppable>
                      </DragDropContext>
                    </div>
                )}

                {activeTab === 'stories' && (
                    <div className="space-y-6">
                      <div className="flex justify-end">
                        <Button
                            onClick={() => setShowGalleryForm(true)}
                            className="w-10 h-10 rounded-full bg-black hover:bg-gray-800 text-white shadow-md"
                            size="icon"
                        >
                          <Plus className="w-5 h-5" />
                        </Button>
                      </div>
                      <DragDropContext onDragEnd={(result) => handleDragEnd(result, galleryImages, setGalleryImages, GalleryImage)}>
                        <Droppable droppableId="gallery">
                          {(provided) => (
                              <div
                                  {...provided.droppableProps}
                                  ref={provided.innerRef}
                                  className="grid md:grid-cols-3 lg:grid-cols-4 gap-4"
                              >
                                {galleryImages.map((item, index) => (
                                    <Draggable key={item.id} draggableId={item.id.toString()} index={index}>
                                      {(provided) => (
                                          <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                          >
                                            <Card className="bg-white rounded-2xl shadow-sm overflow-hidden">
                                              <div className="flex items-center justify-start gap-2 p-2" {...provided.dragHandleProps}>
                                                <GripVertical className="cursor-grab text-gray-400"/>
                                              </div>
                                              <div className="aspect-video bg-gray-100">
                                                <video
                                                    src={
                                                      (item.video_url && item.video_url.startsWith('http')) ? item.video_url
                                                          : (item.image_url && item.image_url.startsWith('http')) ? item.image_url
                                                              : `${(api?.defaults?.baseURL || '').replace(/\/+$/, '')}${item.video_url || item.image_url || ''}`
                                                    }
                                                    className="w-full h-full object-cover"
                                                    muted
                                                    playsInline
                                                    controls={false}
                                                />
                                              </div>
                                              <CardContent className="p-4">
                                                <p className="text-sm text-gray-600 mb-3 truncate">{item.alt_text || 'סרטון'}</p>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleDelete(GalleryImage, item.id, "סרטון")}
                                                    className="w-full text-red-600 hover:text-red-700 hover:bg-red-50"
                                                >
                                                  <Trash2 className="w-4 h-4 mr-1" />
                                                  מחק
                                                </Button>
                                              </CardContent>
                                            </Card>
                                          </div>
                                      )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                              </div>
                          )}
                        </Droppable>
                      </DragDropContext>
                    </div>
                )}

                {activeTab === 'testimonials' && (
                    <div className="space-y-6">
                      <div className="flex justify-end">
                        <Button
                            onClick={() => setShowTestimonialForm(true)}
                            className="w-10 h-10 rounded-full bg-black hover:bg-gray-800 text-white shadow-md"
                            size="icon"
                        >
                          <Plus className="w-5 h-5" />
                        </Button>
                      </div>
                      <DragDropContext onDragEnd={(result) => handleDragEnd(result, testimonials, setTestimonials, Testimonial)}>
                        <Droppable droppableId="testimonials">
                          {(provided) => (
                              <div
                                  {...provided.droppableProps}
                                  ref={provided.innerRef}
                                  className="grid md:grid-cols-2 gap-4"
                              >
                                {testimonials.map((testimonial, index) => (
                                    <Draggable key={testimonial.id} draggableId={testimonial.id.toString()} index={index}>
                                      {(provided) => (
                                          <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                          >
                                            <Card className="bg-white rounded-2xl shadow-sm">
                                              <CardContent className="p-6">
                                                <div className="flex items-center justify-between mb-4">
                                                  <div {...provided.dragHandleProps} className="flex items-center gap-2 cursor-grab text-gray-400">
                                                    <GripVertical />
                                                  </div>
                                                  <div className="flex items-center gap-1">
                                                    {[...Array(5)].map((_, i) => (
                                                        <Star
                                                            key={i}
                                                            className={`w-4 h-4 ${i < testimonial.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                                                        />
                                                    ))}
                                                  </div>
                                                  <div className="flex gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                          setEditingTestimonial(testimonial);
                                                          setShowTestimonialForm(true);
                                                        }}
                                                    >
                                                      <Edit className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleDelete(Testimonial, testimonial.id, "תגובה")}
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                    >
                                                      <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                  </div>
                                                </div>

                                                <p className="text-gray-700 mb-4">"{testimonial.content ?? testimonial.text}"</p>
                                                <p className="font-semibold text-gray-900">— {testimonial.author}</p>
                                              </CardContent>
                                            </Card>
                                          </div>
                                      )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                              </div>
                          )}
                        </Droppable>
                      </DragDropContext>
                    </div>
                )}

                {activeTab === 'background' && (
                    <div className="space-y-6">
                      <div className="flex justify-end">
                        <Button
                            onClick={() => setShowBackgroundVideoForm(true)}
                            className="w-10 h-10 rounded-full bg-black hover:bg-gray-800 text-white shadow-md"
                            size="icon"
                        >
                          <Plus className="w-5 h-5" />
                        </Button>
                      </div>

                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {backgroundVideos.map((video) => {
                          const videoSrc = resolveMediaUrl(video.video_url || video.videoUrl || video.url || "");
                          const isActive = video.is_active ?? video.isActive ?? false;
                          return (
                            <Card key={video.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                              <div className="aspect-video bg-gray-100">
                                <video
                                    src={videoSrc}
                                    className="w-full h-full object-cover"
                                    muted
                                    loop
                                    autoPlay
                                    playsInline
                                />
                              </div>
                              <CardContent className="p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <Badge
                                      className={isActive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                                    {isActive ? "פעיל" : "לא פעיל"}
                                  </Badge>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={async () => {
                                        if (confirm("האם להפוך לסרטון הרקע הפעיל?")) {
                                          try {
                                            await Promise.all(
                                                backgroundVideos.map(v =>
                                                    BackgroundVideo.update(v.id, { is_active: v.id === video.id })
                                                )
                                            );
                                            loadData();
                                          } catch (error) {
                                            console.error("Error setting active background video:", error);
                                          }
                                        }
                                      }}
                                      className="flex-1"
                                      disabled={isActive}
                                  >
                                    {isActive ? "פעיל" : "הפעל"}
                                  </Button>
                                  <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleDelete(BackgroundVideo, video.id, "סרטון רקע")}
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {sidebarOpen && (
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
                onClick={() => setSidebarOpen(false)}
            ></div>
        )}

        {showQuickActionsModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={() => setShowQuickActionsModal(false)}>
              <motion.div
                  initial={{ scale: 0.9, opacity: 0, y: 30 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: 30 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl mx-auto"
              >
                <div className="text-center mb-6">
                  <h3 className="text-xl font-bold text-gray-900">פעולות מהירות</h3>
                  <p className="text-gray-600 text-sm mt-1">מה תרצה לעשות?</p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-center">
                  {(activeTab === 'clients'
                    ? [
                      { label: "הוספת לקוח", icon: User, action: () => { setShowQuickActionsModal(false); setShowClientForm(true); } },
                      { label: "ייבוא לקוחות מאקסל", icon: FileSpreadsheet, action: () => { setShowQuickActionsModal(false); setShowImportClientsModal(true); } },
                    ]
                    : activeTab === 'appointments'
                      ? [
                        { label: "הוספת תור", icon: Plus, action: () => { setShowQuickActionsModal(false); setShowAddAppointmentForm(true); } },
                        { label: "רשימת המתנה", icon: Clock, action: () => { setShowQuickActionsModal(false); setShowWaitingListView(true); } },
                        { label: "חסימת תורים", icon: Ban, action: () => { setShowQuickActionsModal(false); setShowBlockingForm(true); } },
                        { label: "הודעה ללקוחות", icon: MessageSquare, action: () => { setShowQuickActionsModal(false); setShowMessageModal(true); } },
                        { label: "בקשות לביטול", icon: XCircle, action: () => {
                            setShowQuickActionsModal(false);
                            alert("בקשות לביטול יתווסף בעדכון הבא למערכת!");
                          } },
                      ]
                      : []
                  ).map(item => (
                      <div key={item.label} onClick={item.action} className="p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 cursor-pointer transition-colors flex flex-col items-center justify-center space-y-2">
                        <item.icon className="w-8 h-8 text-gray-700" />
                        <span className="text-sm font-medium text-gray-800">{item.label}</span>
                      </div>
                  ))}
                </div>

                <Button
                    onClick={() => setShowQuickActionsModal(false)}
                    variant="outline"
                    className="w-full mt-6 rounded-full py-3"
                >
                  סגור
                </Button>
              </motion.div>
            </div>
        )}

        {showMessageModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={closeMessageModal}>
              <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl mx-auto"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-gray-900">הודעה ללקוחות</h3>
                  <Button
                      variant="ghost"
                      size="icon"
                      onClick={closeMessageModal}
                      className="rounded-full"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="block text-sm font-medium text-gray-700 mb-2">
                      תוכן ההודעה
                    </Label>
                    <textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder="כתוב כאן את ההודעה שתרצה לשלוח לכל הלקוחות..."
                        className="w-full h-32 p-3 border border-gray-300 rounded-xl resize-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                        onClick={closeMessageModal}
                        variant="outline"
                        className="flex-1 rounded-full py-3"
                    >
                      ביטול
                    </Button>
                    <Button
                        onClick={handleSendGeneralWhatsApp}
                        className="flex-1 bg-black text-white rounded-full py-3"
                        disabled={!messageText.trim() || sendingMessage}
                    >
                      <Send className="w-4 h-4 ml-2" />
                      {sendingMessage ? 'שולח...' : 'שלח הודעה'}
                    </Button>
                  </div>
                </div>
              </motion.div>
            </div>
        )}

        <Dialog
          open={clientDetailsModal.isOpen}
          onOpenChange={(open) => {
            if (!open) closeClientDetailsModal();
          }}
        >
          <DialogContent className="max-w-2xl sm:max-w-3xl rounded-[32px] border-0 bg-transparent p-0 shadow-none" aria-describedby={undefined}>
            {clientDetailsModal.client && (() => {
              const client = clientDetailsModal.client;
              const memberFlag = Boolean(client.isMember ?? client.is_member);
              const first = client.first_name ?? client.firstName ?? '';
              const last = client.last_name ?? client.lastName ?? '';
              const clientDisplayName = [first, last].filter(Boolean).join(' ').trim() || 'לקוח';
              const phoneDisplay = client.phone ?? client.client_phone ?? '';
              const upcomingCount = clientDetailsUpcomingCount;
              return (
                  <div className="space-y-5 rounded-[32px] bg-white/95 p-5 sm:p-8">
                    <DialogHeader>
                      <DialogTitle>פרטי לקוח</DialogTitle>
                      <DialogDescription>
                        כל המידע וההיסטוריה של {clientDisplayName}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-[28px] bg-gray-50 p-5 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-xl font-semibold text-gray-900">{clientDisplayName}</p>
                        {memberFlag && (
                            <Badge variant="secondary" className="flex items-center gap-1 bg-amber-100 text-amber-700">
                              <Crown className="w-4 h-4" />
                              <span>חבר מועדון</span>
                            </Badge>
                        )}
                      </div>
                      <p className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <span>{phoneDisplay || 'ללא מספר טלפון'}</span>
                      </p>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                        <span>סה"כ תורים עתידיים: {upcomingCount}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                        <Repeat className="w-4 h-4 text-emerald-600" />
                        <span>תורים קבועים</span>
                      </div>
                      {clientDetailsRecurringMeta.length > 0 ? (
                          <div className="space-y-2">
                            {clientDetailsRecurringMeta.map((item) => (
                                <div key={item.scheduleKey} className="rounded-2xl border border-emerald-100 bg-white p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-semibold text-emerald-700">
                                      {item.dayLabel}{item.timeLabel ? ` · ${item.timeLabel}` : ''}
                                    </div>
                                    <span className="text-xs text-emerald-600">{item.intervalLabel}</span>
                                  </div>
                                  {item.serviceLabel && (
                                      <p className="text-xs text-gray-500 mt-1">{item.serviceLabel}</p>
                                  )}
                                </div>
                            ))}
                          </div>
                      ) : (
                          <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-gray-300 bg-white/70 px-3 py-1 text-xs text-gray-500 w-fit">
                            <Repeat className="w-3 h-3 text-gray-400" />
                            <span>אין תור קבוע</span>
                          </div>
                      )}
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-gray-800">התורים הקרובים</h4>
                        <span className="text-xs text-gray-500">{upcomingCount === 0 ? 'אין תורים עתידיים' : `${upcomingCount} תורים`}</span>
                      </div>
                      {clientDetailsAppointmentsLoading ? (
                          <p className="text-sm text-gray-500">טוען תורים…</p>
                      ) : clientDetailsAppointmentsError ? (
                          <div className="rounded-xl border border-dashed border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {clientDetailsAppointmentsError}
                          </div>
                      ) : clientDetailsAppointments.length === 0 ? (
                          <p className="text-sm text-gray-500">אין תורים להצגה.</p>
                      ) : (
                          <div className="max-h-[420px] overflow-y-auto space-y-3 pr-1">
                            {clientDetailsAppointments.map((apt) => {
                              const service = serviceById(apt.service_id);
                              const serviceLabel = service?.name ?? service?.title ?? 'ללא שירות';
                              let dateLabel = apt.starts_at || '';
                              try {
                                dateLabel = format(new Date(apt.starts_at), 'dd/MM/yyyy · HH:mm', { locale: he });
                              } catch (_) {}
                              const isProcessing = cancelingAppointmentId === apt.id;
                              return (
                                  <div key={`${apt.id}-${apt.starts_at}`} className="rounded-2xl border border-gray-200 bg-white/90 p-3 sm:p-4 flex items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-base font-semibold text-gray-900 truncate">{dateLabel}</p>
                                      <p className="text-sm text-gray-600 truncate">{serviceLabel}</p>
                                      {apt.note && (
                                          <p className="text-xs text-gray-500 truncate">הערה: {apt.note}</p>
                                      )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-red-600 hover:text-red-700"
                                        onClick={() => handleCancelSingleAppointment(apt)}
                                        disabled={isProcessing}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      <span className="sr-only">בטל תור</span>
                                    </Button>
                                  </div>
                              );
                            })}
                          </div>
                      )}
                    </div>
                  </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        <Dialog
          open={recurringCancelModal.isOpen}
          onOpenChange={(open) => {
            if (!open) closeRecurringCancelModal();
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>ביטול תור קבוע</DialogTitle>
              <DialogDescription>
                פעולה זו תבטל את התור הקבוע של {recurringCancelModal.clientName} ותמחק את כל התורים העתידיים שלו.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-800 space-y-1">
              <p className="font-semibold">{recurringCancelModal.clientName}</p>
              {recurringCancelModal.scheduleLabel && (
                  <p>תור: {recurringCancelModal.scheduleLabel}</p>
              )}
              {recurringCancelModal.intervalLabel && (
                  <p>{recurringCancelModal.intervalLabel}</p>
              )}
              {recurringCancelModal.serviceLabel && (
                  <p>{recurringCancelModal.serviceLabel}</p>
              )}
            </div>
            <p className="text-sm text-gray-600">הביטול ייכנס לתוקף מיד ולא ניתן לשחזר את התורים שנמחקו.</p>
            <DialogFooter className="gap-2">
              <Button
                  variant="outline"
                  onClick={closeRecurringCancelModal}
                  disabled={cancelingRecurringId === recurringCancelModal.scheduleId}
              >
                חזרה
              </Button>
              <Button
                  variant="destructive"
                  onClick={handleConfirmRecurringCancellation}
                  disabled={cancelingRecurringId === recurringCancelModal.scheduleId}
              >
                {cancelingRecurringId === recurringCancelModal.scheduleId ? 'מבטל…' : 'בטל את התור הקבוע'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {recurringSuccessModal.isOpen && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-4" onClick={closeRecurringSuccessModal}>
              <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">תורים קבועים</h3>
                  </div>
                  <Button variant="ghost" size="icon" onClick={closeRecurringSuccessModal} className="rounded-full">
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <p className="text-gray-700 text-sm leading-relaxed">{recurringSuccessModal.message}</p>
                {Array.isArray(recurringSuccessModal.skippedDates) && recurringSuccessModal.skippedDates.length > 0 && (
                    <div className="mt-4 bg-gray-50 rounded-2xl p-4">
                      <p className="text-sm font-semibold text-gray-800 mb-2">תאריכים שלא נקבעו:</p>
                      <ul className="text-sm text-gray-600 list-disc pr-5 space-y-1">
                        {recurringSuccessModal.skippedDates.map((date) => (
                            <li key={date}>{date}</li>
                        ))}
                      </ul>
                    </div>
                )}
                <Button className="w-full mt-6 rounded-full" onClick={closeRecurringSuccessModal}>
                  סגור
                </Button>
              </motion.div>
            </div>
        )}

        {recurringConflictModal.isOpen && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-4" onClick={closeRecurringConflictModal}>
              <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                      <X className="w-6 h-6 text-red-600" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">לא ניתן לקבוע תור קבוע</h3>
                  </div>
                  <Button variant="ghost" size="icon" onClick={closeRecurringConflictModal} className="rounded-full">
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <p className="text-gray-700 text-sm leading-relaxed">{recurringConflictModal.message}</p>
                {Array.isArray(recurringConflictModal.conflicts) && recurringConflictModal.conflicts.length > 0 && (
                    <div className="mt-4 bg-red-50 rounded-2xl p-4">
                      <p className="text-sm font-semibold text-red-700 mb-2">תורים מתנגשים:</p>
                      <ul className="text-sm text-red-700 list-disc pr-5 space-y-1">
                        {recurringConflictModal.conflicts.map((conflict, index) => (
                            <li key={`${conflict.id ?? 'conflict'}-${index}`}>{formatRecurringConflict(conflict)}</li>
                        ))}
                      </ul>
                      {recurringConflictModal.hasMore && (
                          <p className="text-xs text-red-600 mt-2">יש עוד תורים מתנגשים מעבר לרשימה.</p>
                      )}
                    </div>
                )}
                <Button className="w-full mt-6 rounded-full" onClick={closeRecurringConflictModal}>
                  סגור
                </Button>
              </motion.div>
            </div>
        )}

        {showAddAppointmentForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
              <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="bg-white p-6 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
              >
                <AdminAppointmentForm
                    onSubmit={async (appointmentData) => {
                      await handleAddAppointment(appointmentData);
                      setShowAddAppointmentForm(false);
                    }}
                    onCancel={() => setShowAddAppointmentForm(false)}
                    services={services}
                    appointments={appointments}
                    businessHours={businessHours}
                    clients={allClients}
                />
              </motion.div>
            </div>
        )}

        <BlockAppointmentsModal
            isOpen={showBlockingForm}
            onClose={() => setShowBlockingForm(false)}
            businessHours={businessHours}
            onBlock={async () => {
              setShowBlockingForm(false);
              await reloadBlocks();
              await loadData();
            }}
            appointments={appointments}
        />

        <Dialog open={Boolean(pendingCalendarMove)} onOpenChange={(open) => {
          if (!open && !isSavingCalendarMove) setPendingCalendarMove(null);
        }}>
          <DialogContent className="max-w-[320px] rounded-2xl" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle className="text-base">אישור שינוי תור</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                התור של {pendingCalendarMove?.clientName || 'לקוח'} יועבר מ-{pendingCalendarMove?.fromLabel} ל-{pendingCalendarMove?.toLabel}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 items-center sm:items-end">
              <Button size="sm" className="w-auto min-w-24" variant="outline" onClick={() => setPendingCalendarMove(null)} disabled={isSavingCalendarMove}>
                ביטול
              </Button>
              <Button size="sm" className="w-auto min-w-24" onClick={submitCalendarMove} disabled={isSavingCalendarMove}>
                {isSavingCalendarMove ? 'שומר…' : 'אישור'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {dragPreview && (
            <div
                className="fixed z-[250] pointer-events-none"
                style={{
                  left: dragPreview.x,
                  top: dragPreview.y,
                  transform: 'translate(-50%, -120%)',
                }}
            >
              <div className="rounded-lg bg-black/90 text-white px-2 py-1 shadow-xl min-w-[84px] text-right">
                <div className="text-xs font-semibold truncate">{dragPreview.title}</div>
                <div className="text-[10px] opacity-80">{dragPreview.time}</div>
              </div>
            </div>
        )}


        {selectedAppointment && (
            <AppointmentActionsModal
                isOpen={!!selectedAppointment}
                onClose={() => setSelectedAppointment(null)}
                appointment={selectedAppointment}
                service={serviceById(selectedAppointment?.service_id)}
                businessHours={businessHours}
                allAppointments={appointments}
                onDelete={async () => {
                  await handleDelete(Appointment, selectedAppointment.id, "תור");
                  setSelectedAppointment(null);
                }}
                onStatusChange={handleStatusChange}
                onReschedule={handleRescheduleSubmit}
                onCreateRecurring={(interval) => handleCreateRecurringAppointment(selectedAppointment, interval)}
            />
        )}


        {selectedWaitingEntry && (
            <WaitingListActionModal
                isOpen={!!selectedWaitingEntry}
                onClose={() => setSelectedWaitingEntry(null)}
                entry={selectedWaitingEntry}
                service={services.find(s => s.id === selectedWaitingEntry.service_id)}
                onBooked={() => {
                  setSelectedWaitingEntry(null);
                  loadAppointmentsForDate(selectedDate);
                  loadWaitingListForDate(selectedDate);
                }}
                onRemoved={() => {
                  setSelectedWaitingEntry(null);
                  loadWaitingListForDate(selectedDate);
                }}
            />
        )}


        {showClientForm && (
            <Dialog open={showClientForm} onOpenChange={setShowClientForm}>
              <DialogContent className="max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>הוספת לקוח חדש</DialogTitle>
                </DialogHeader>
                <ClientForm
                    onSubmit={handleClientSubmit}
                    onCancel={() => setShowClientForm(false)}
                />
              </DialogContent>
            </Dialog>
        )}

        {showImportClientsModal && (
            <Dialog
                open={showImportClientsModal}
                onOpenChange={(open) => {
                  if (!open) {
                    setShowImportClientsModal(false);
                    setImportClientsFile(null);
                    setImportClientsPreview([]);
                    setImportClientsFeedback(null);
                  }
                }}
            >
              <DialogContent className="max-w-lg" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>ייבוא לקוחות מאקסל</DialogTitle>
                  <DialogDescription>
                    קובץ אקסל צריך לכלול שלושה עמודות: שם פרטי, שם משפחה, מספר טלפון.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="clients-import-file">קובץ אקסל</Label>
                    <Input
                        id="clients-import-file"
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleImportClientsFileChange}
                    />
                    <p className="text-xs text-gray-500">ניתן לעלות גם CSV. השורה הראשונה יכולה להיות כותרת.</p>
                  </div>

                  {importClientsLoading && (
                      <div className="text-sm text-gray-600">טוען נתונים מהקובץ...</div>
                  )}

                  {importClientsPreview.length > 0 && (
                      <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-3">
                        <p className="text-sm font-semibold text-gray-700 mb-2">תצוגה מקדימה</p>
                        <div className="space-y-1 text-sm text-gray-600">
                          {importClientsPreview.map((entry, index) => (
                              <div key={`${entry.phone}-${index}`} className="flex justify-between gap-2">
                                <span className="truncate">{entry.first_name} {entry.last_name}</span>
                                <span className="text-gray-500">{entry.phone}</span>
                              </div>
                          ))}
                        </div>
                      </div>
                  )}

                  {importClientsFeedback && (
                      <Alert>
                        <AlertDescription className="text-sm text-gray-700 space-y-1">
                          {"entriesCount" in importClientsFeedback && (
                              <p>נמצאו {importClientsFeedback.entriesCount} לקוחות בקובץ.</p>
                          )}
                          {"createdCount" in importClientsFeedback && (
                              <p>נוספו {importClientsFeedback.createdCount} לקוחות חדשים.</p>
                          )}
                          {"skippedExisting" in importClientsFeedback && (
                              <p>דולגו {importClientsFeedback.skippedExisting} לקוחות קיימים.</p>
                          )}
                          {"failedCount" in importClientsFeedback && (
                              <p>נכשלו {importClientsFeedback.failedCount} לקוחות.</p>
                          )}
                          {Array.isArray(importClientsFeedback.invalidRows) && importClientsFeedback.invalidRows.length > 0 && (
                              <p>שורות בעייתיות: {importClientsFeedback.invalidRows.length}.</p>
                          )}
                        </AlertDescription>
                      </Alert>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button
                      variant="outline"
                      onClick={() => {
                        setShowImportClientsModal(false);
                        setImportClientsFile(null);
                        setImportClientsPreview([]);
                        setImportClientsFeedback(null);
                      }}
                  >
                    סגור
                  </Button>
                  <Button onClick={handleImportClients} disabled={importClientsLoading}>
                    {importClientsLoading ? "מייבא..." : "הוסף"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
        )}

        {showServiceForm && (
            <Dialog open={showServiceForm} onOpenChange={setShowServiceForm}>
              <DialogContent className="max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>{editingService ? 'עריכת שירות' : 'הוספת שירות חדש'}</DialogTitle>
                </DialogHeader>
                <ServiceForm
                    service={editingService}
                    onSubmit={handleServiceSubmit}
                    onCancel={() => {
                      setShowServiceForm(false);
                      setEditingService(null);
                    }}
                />
              </DialogContent>
            </Dialog>
        )}

        {showTestimonialForm && (
            <Dialog open={showTestimonialForm} onOpenChange={setShowTestimonialForm}>
              <DialogContent className="max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>{editingTestimonial ? 'עריכת תגובה' : 'הוספת תגובה חדשה'}</DialogTitle>
                </DialogHeader>
                <TestimonialForm
                    testimonial={editingTestimonial}
                    onSubmit={handleTestimonialSubmit}
                    onCancel={() => {
                      setShowTestimonialForm(false);
                      setEditingTestimonial(null);
                    }}
                />
              </DialogContent>
            </Dialog>
        )}

        {showGalleryForm && (
            <Dialog open={showGalleryForm} onOpenChange={setShowGalleryForm}>
              <DialogContent className="max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>הוספת סרטון חדש</DialogTitle>
                </DialogHeader>
                <GalleryForm
                    onSubmit={async (data) => {
                      try {
                        await GalleryImage.create(data);
                        loadData();
                        setShowGalleryForm(false);
                      } catch (error) {
                        console.error("Error adding video:", error);
                      }
                    }}
                    onCancel={() => setShowGalleryForm(false)}
                />
              </DialogContent>
            </Dialog>
        )}

        {showBackgroundVideoForm && (
            <Dialog open={showBackgroundVideoForm} onOpenChange={setShowBackgroundVideoForm}>
              <DialogContent className="max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>הוספת סרטון רקע חדש</DialogTitle>
                </DialogHeader>
                <BackgroundVideoForm
                    onSubmit={async (data) => {
                      try {
                        await Promise.all(
                            backgroundVideos.map(v => BackgroundVideo.update(v.id, { is_active: false }))
                        );
                        await BackgroundVideo.create({ ...data, is_active: true });
                        loadData();
                        setShowBackgroundVideoForm(false);
                      } catch (error) {
                        console.error("Error adding background video:", error);
                        alert("שגיאה בהוספת סרטון רקע: " + error.message);
                      }
                    }}
                    onCancel={() => setShowBackgroundVideoForm(false)}
                />
              </DialogContent>
            </Dialog>
        )}

        {showProductForm && (
            <Dialog open={showProductForm} onOpenChange={setShowProductForm}>
              <DialogContent className="max-w-md" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>{editingProduct ? 'עריכת מוצר' : 'הוספת מוצר חדש'}</DialogTitle>
                </DialogHeader>
                <ProductForm
                    product={editingProduct}
                    onSubmit={handleProductSubmit}
                    onCancel={() => {
                      setShowProductForm(false);
                      setEditingProduct(null);
                    }}
                />
              </DialogContent>
            </Dialog>
        )}
      </div>
  );
}

// Client Form Component
function ClientForm({ onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    is_member: false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>שם פרטי</Label>
          <Input
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              required
          />
        </div>
        <div>
          <Label>שם משפחה</Label>
          <Input
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              required
          />
        </div>
        <div>
          <Label>טלפון</Label>
          <Input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              required
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium">חבר מועדון</p>
            <p className="text-xs text-gray-500">חברים יכולים להזמין עד שבועיים מראש</p>
          </div>
          <Switch
              checked={formData.is_member}
              onCheckedChange={(val) => setFormData({ ...formData, is_member: Boolean(val) })}
          />
        </div>
        <div className="flex gap-3 pt-4">
          <Button type="submit" className="flex-1">
            הוסף לקוח
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            ביטול
          </Button>
        </div>
      </form>
  );
}

// Service Form Component
function ServiceForm({ service, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: service?.name || "",
    description: service?.description || "",
    durationMinutes: service?.durationMinutes ?? service?.duration_minutes ?? 30,
    price: service?.price || 0,
    isActive: service?.isActive ?? service?.is_active ?? true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>שם השירות</Label>
          <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
          />
        </div>

        <div>
          <Label>תיאור</Label>
          <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>משך (דקות)</Label>
            <Input
                type="number"
                value={formData.durationMinutes}
                onChange={(e) => setFormData({ ...formData, durationMinutes: parseInt(e.target.value) })}
                required
            />
          </div>
          <div>
            <Label>מחיר (₪)</Label>
            <Input
                type="number"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: parseInt(e.target.value) })}
                required
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
              type="checkbox"
              id="active"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
          />
          <Label htmlFor="active">שירות פעיל</Label>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="submit" className="flex-1">
            {service ? 'עדכן' : 'הוסף'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            ביטול
          </Button>
        </div>
      </form>
  );
}

// Testimonial Form Component
function TestimonialForm({ testimonial, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    author: testimonial?.author || "",
    text: testimonial?.text ?? testimonial?.content ?? "",
    content: testimonial?.content ?? testimonial?.text ?? "",
    rating: testimonial?.rating || 5
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      text: formData.text?.toString() ?? "",
      content: formData.content?.toString() ?? formData.text ?? "",
    });
  };

  return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>שם הלקוח</Label>
          <Input
              value={formData.author}
              onChange={(e) => setFormData({ ...formData, author: e.target.value })}
              required
          />
        </div>

        <div>
          <Label>תוכן התגובה</Label>
          <Textarea
              value={formData.text}
              onChange={(e) => {
                const value = e.target.value;
                setFormData({ ...formData, text: value, content: value });
              }}
              required
          />
        </div>

        <div>
          <Label>דירוג</Label>
          <Select value={formData.rating.toString()} onValueChange={(value) => setFormData({ ...formData, rating: parseInt(value) })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 כוכב</SelectItem>
              <SelectItem value="2">2 כוכבים</SelectItem>
              <SelectItem value="3">3 כוכבים</SelectItem>
              <SelectItem value="4">4 כוכבים</SelectItem>
              <SelectItem value="5">5 כוכבים</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="submit" className="flex-1">
            {testimonial ? 'עדכן' : 'הוסף'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            ביטול
          </Button>
        </div>
      </form>
  );
}

// Gallery Form Component with File Upload
function GalleryForm({ onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    alt_text: "",
    order_index: 0
  });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      alert("נא לבחור קובץ וידאו");
      return;
    }

    setUploading(true);
    try {
      // שרת מחזיר { ok:true, url: "/uploads/..." }
      console.log('selected file:', file?.name, file?.type, file); // צריך לראות שם/סוג
      const { previewUrl, fullUrl, url } = await UploadFile.upload(file);

      // נבנה URL מוחלט לפי הבסיס של axios (api)
      const base = (api?.defaults?.baseURL || '').replace(/\/+$/,''); // בלי "/" בסוף
      const previewAbs = previewUrl
        ? (previewUrl.startsWith('http') ? previewUrl : `${base}${previewUrl}`)
        : (url.startsWith('http') ? url : `${base}${url}`);
      const fullAbs = fullUrl
        ? (fullUrl.startsWith('http') ? fullUrl : `${base}${fullUrl}`)
        : previewAbs;

      await onSubmit({
        // נשמור את שלושתם כדי שכל מקום בקוד ימצא מה שהוא צריך:
        image_url: previewAbs,
        video_url: fullAbs,
        url:       fullAbs,
        full_url:  fullAbs,
        alt_text:  formData.alt_text,
        order_index: formData.order_index
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("שגיאה בהעלאת הקובץ");
    } finally {
      setUploading(false);
    }
  };

  return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>בחר קובץ וידאו (MP4)</Label>
          <Input
              type="file"
              accept="video/mp4,video/*"
              onChange={(e) => setFile(e.target.files[0])}
              required
          />
        </div>

        <div>
          <Label>תיאור</Label>
          <Input
              value={formData.alt_text}
              onChange={(e) => setFormData({ ...formData, alt_text: e.target.value })}
              required
          />
        </div>

        <div>
          <Label>סדר תצוגה</Label>
          <Input
              type="number"
              value={formData.order_index}
              onChange={(e) => setFormData({ ...formData, order_index: parseInt(e.target.value) })}
          />
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="submit" className="flex-1" disabled={uploading}>
            {uploading ? "מעלה..." : "הוסף"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={uploading}>
            ביטול
          </Button>
        </div>
      </form>
  );
}

// Background Video Form Component with File Upload
function BackgroundVideoForm({ onSubmit, onCancel }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("נא לבחור קובץ וידאו");
    setUploading(true);
    try {
      const { previewUrl, fullUrl, url } = await UploadFile.upload(file);
      const previewSource = previewUrl || url;
      const fullSource = fullUrl || url;
      const previewAbsolute = resolveMediaUrl(previewSource);
      const fullAbsolute = resolveMediaUrl(fullSource);
      await onSubmit({
        video_url: fullAbsolute,
        image_url: previewAbsolute,
        full_url: fullAbsolute,
        url: fullAbsolute,
      });
    } catch (err) {
      console.error("Error uploading file:", err);
      alert("שגיאה בהעלאת הקובץ");
    } finally {
      setUploading(false);
    }
  };


  return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>בחר קובץ וידאו (MP4)</Label>
          <Input
              type="file"
              accept="video/mp4,video/*"
              onChange={(e) => setFile(e.target.files[0])}
              required
          />
        </div>

        <div className="flex gap-3 pt-4">
          <Button type="submit" className="flex-1" disabled={uploading}>
            {uploading ? "מעלה..." : "הוסף"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={uploading}>
            ביטול
          </Button>
        </div>
      </form>
  );
}
