import React, { useState, useEffect } from "react";
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
import { UploadFile } from "@/api/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectValue, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
} from "lucide-react";
import { format, addDays, startOfWeek, isSameDay, startOfDay, subDays, isAfter, setHours, setMinutes, isBefore, isSameHour, isSameMinute, isSameSecond, addMinutes, differenceInDays } from "date-fns";
import { he } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import ProductForm from "../components/ProductForm.jsx";
import AdminAppointmentForm from "../components/AdminAppointmentForm.jsx";
import AppointmentActionsModal from "../components/AppointmentActionsModal.jsx";
import RescheduleModal from "../components/RescheduleModal.jsx";
import BlockAppointmentsModal from "../components/BlockAppointmentsModal.jsx";
import WaitingListActionModal from "../components/WaitingListActionModal.jsx";
import { useSidebar } from "../components/SidebarContext.jsx"; // Import the context hook
import { fullName, serviceName, isPast, phone } from '@/lib/apt-utils';
import { Admin as AdminApi } from "@/api/entities";
import api from "@/api/base44Client";


const navItems = [
  { id: 'appointments', label: 'תורים', icon: Calendar },
  //{ id: 'statistics', label: 'סטטיסטיקות', icon: BarChart3 },
  { id: 'clients', label: 'לקוחות', icon: Users },
  { id: 'services', label: 'שירותים', icon: Settings },
  { id: 'products', label: 'מוצרים', icon: Package },
  { id: 'stories', label: 'סטוריז', icon: Video },
  { id: 'testimonials', label: 'תגובות', icon: MessageSquare },
  { id: 'background', label: 'סרטון רקע', icon: Video },
];

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
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [galleryImages, setGalleryImages] = useState([]);
  const [businessHours, setBusinessHours] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [backgroundVideos, setBackgroundVideos] = useState([]);
  const [products, setProducts] = useState([]);
  const [waitingList, setWaitingList] = useState([]);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [selectedWaitingEntry, setSelectedWaitingEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("appointments");

  const [showQuickActionsModal, setShowQuickActionsModal] = useState(false);
  const [showAddAppointmentForm, setShowAddAppointmentForm] = useState(false);
  const [showBlockingForm, setShowBlockingForm] = useState(false);

  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageText, setMessageText] = useState('');

  const [rescheduleData, setRescheduleData] = useState({ isOpen: false, appointment: null, service: null });

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

  const [showWaitingListView, setShowWaitingListView] = useState(false);

  // ====== חסימות זמנים (Admin.blocks) ======
  const [blocks, setBlocks] = useState([]);

// תאריך היום הנבחר כמחרוזת YYYY-MM-DD
  const selectedDateStr = React.useMemo(
      () => format(startOfDay(selectedDate), "yyyy-MM-dd"),
      [selectedDate]
  );

  // guard: מוודא שיש לקוח ובעל הרשאת אדמין, אחרת מחזיר לדף הבית
  useEffect(() => {
    try {
      const raw = localStorage.getItem("familiaClient");
      const client = raw ? JSON.parse(raw) : null;
      if (!client?.isAdmin) {
        navigate(createPageUrl("Home"));
        return;
      }
      setCanAccessAdmin(true);
    } catch {
      navigate(createPageUrl("Home"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  async function handleAdminCodeSubmit(e) {
    e?.preventDefault?.();
    setAuthError("");
    try {
      const res = await api.post('/admin/verify-code', { code: adminCode });
      if (res?.ok) {
        setIsCodeVerified(true);
        setIsAuthenticated(true);
        await loadData();
        return;
      }
      setAuthError("קוד אדמין שגוי.");
    } catch (err) {
      setAuthError("קוד אדמין שגוי.");
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

  const daysForPicker = React.useMemo(() => {
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


  const loadData = async () => {
    try {
      setLoading(true);

      const now = new Date();
      const oneWeekAgo = startOfDay(subDays(now, 7));

      const [
        allAppointmentsData, servicesData, testimonialsData,
        galleryData, hoursData, clientsData, backgroundVideosData,
        productsData, waitingListData
      ] = await Promise.all([
        listAny(Appointment, "-starts_at").catch(() => []),
        listAny(Service, "order_index").catch(() => []),
        listAny(Testimonial, "order_index").catch(() => []),
        listAny(GalleryImage, "order_index").catch(() => []),
        listAny(BusinessHours).catch(() => []),
        loadClients(),                                // ← לקוחות
        listAny(BackgroundVideo).catch(() => []),     // ← סרטוני רקע (פעם אחת!)
        listAny(Product, "order_index").catch(() => []),
        (WaitingList.filter
                ? WaitingList.filter({ status: 'waiting' }, '-desired_starts_at')
                : listAny(WaitingList, '-desired_starts_at')
        ).catch(() => [])
      ]);

      const processedAppointments = [];
      for (const apt of allAppointmentsData || []) {
        const appointmentStartTime = new Date(apt.starts_at);
        const appointmentEndTime = new Date(apt.ends_at);

        if (isAfter(now, appointmentEndTime) && apt.status === 'booked') {
          // UI-only: מציג כ'הושלם' בלי לגעת בשרת
          processedAppointments.push({ ...apt, status: 'completed' });
        }
        else {
          processedAppointments.push(apt);
        }
      }

      setAppointments(processedAppointments);
      setServices(servicesData || []);
      setTestimonials(testimonialsData || []);
      setGalleryImages(galleryData || []);
      setBusinessHours(hoursData || []);
      setAllClients(clientsData || []);
      setBackgroundVideos(backgroundVideosData || []);
      setProducts(productsData || []);
      setWaitingList(waitingListData || []);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getAppointmentsForDay = (date) => {
    return appointments
        .filter(apt =>
            apt.status !== 'canceled' &&
            apt.status !== 'blocked' &&            // 👈 אל תציג חסימות ביומן התורים
            isSameDay(new Date(apt.starts_at), date)
        )
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  };

  const getWaitingListForDay = (date) => {
    return waitingList.filter(entry =>
        isSameDay(new Date(entry.desired_starts_at), date)
    ).sort((a, b) => new Date(a.desired_starts_at) - new Date(b.desired_starts_at));
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

  const handleRescheduleRequest = (appointment, service) => {
    setSelectedAppointment(null);
    setRescheduleData({ isOpen: true, appointment, service });
  };

  const handleRescheduleSubmit = async (newStartTime) => {
    try {
      const service = rescheduleData.service;
      const appointment = rescheduleData.appointment;

      const newEndTime = addMinutes(newStartTime, service.duration_minutes);

      await Appointment.update(appointment.id, {
        starts_at: newStartTime.toISOString(),
        ends_at: newEndTime.toISOString(),
      });

      setRescheduleData({ isOpen: false, appointment: null, service: null });
      loadData();

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
      const updatePromises = reorderedList.map((item, index) =>
          entity.update(item.id, { ...item, order_index: index })
      );
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
    try {
      if (editingTestimonial) {
        await Testimonial.update(editingTestimonial.id, testimonialData);
      } else {
        await Testimonial.create(testimonialData);
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

  const toggleClientMembership = async (client) => {
    if (!client?.id) return;
    const current = Boolean(client.isMember ?? client.is_member);
    const payload = { is_member: !current };
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

  const clientDataWithAppointments = React.useMemo(() => {
    const now = new Date();
    return (allClients || []).map(c => {
      // לא מסננים לקוחות בלי טלפון – פשוט לא תהיה להם היסטוריה תורים
      const cPhone = normalizePhone(c.phone ?? c.client_phone ?? "");

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
      const lastDate = last ? new Date(last.starts_at) : null;
      const isRecent = lastDate ? differenceInDays(now, lastDate) <= 30 : false;

      return { ...c, lastAppointmentDate: lastDate, lastAppointmentRecent: isRecent };
    });
  }, [allClients, appointments]);

  const blocksForSelectedDay = React.useMemo(() => {
    return (blocks || []).filter((b) => {
      const s = new Date(b.start_at || b.startAt);
      return !Number.isNaN(s.getTime()) && isSameDay(s, selectedDate);
    }).sort((a,b) => new Date(a.start_at || a.startAt) - new Date(b.start_at || b.startAt));
  }, [blocks, selectedDate]);


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

  // אם אין עדיין אישור אדמין מהguard, אפשר להחזיר null/ספינר קצר
  if (!canAccessAdmin) {
    return null; // או ספינר קל אם תרצה
  }

// תמיד דורשים קוד — גם לאדמין — עד שיאומת
  if (!isCodeVerified) {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" dir="rtl">
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
                    variant={activeTab === item.id ? "secondary" : "ghost"}
                    className="w-full justify-start text-lg gap-3 py-3"
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
                        {getWaitingListForDay(selectedDate).length > 0 ? (
                            getWaitingListForDay(selectedDate).map(entry => {
                              const service = services.find(s => s.id === entry.service_id);
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
                                      <p className="font-bold text-gray-900 text-sm">
                                        {format(new Date(entry.desired_starts_at), 'HH:mm')}
                                      </p>
                                    </div>
                                    <div className="w-px bg-gray-200 h-10 self-center mx-1"></div>
                                    <div className="flex-1">
                                      <h4 className="font-bold text-gray-900">
                                        {entry.client_name}
                                      </h4>
                                      <p className="text-sm text-gray-600">{service?.name || 'שירות לא ידוע'}</p>
                                    </div>
                                    <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-700" onClick={(e) => { e.stopPropagation(); setSelectedWaitingEntry(entry); }}>
                                      <MoreVertical className="w-5 h-5" />
                                    </Button>
                                  </motion.div>
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
                      <div className="flex items-center gap-3 mb-4">
                        <h2 className="text-2xl font-bold text-gray-800">ניהול תורים</h2>
                      </div>

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

                      <div className="space-y-3">
                        {getAppointmentsForDay(selectedDate).length > 0 ? (
                            getAppointmentsForDay(selectedDate).map(apt => {
                              const service = serviceById(apt.service_id)
                              const isCompleted = apt.status === 'completed';
                              const isBlocked = apt.status === 'blocked';
                              const passed = isAfter(new Date(), new Date(apt.ends_at));
                              const displayName = isBlocked ? 'חסום' : ((
                                  (apt.client_name && String(apt.client_name).trim()) ||
                                  (apt.client?.name && String(apt.client.name).trim()) ||
                                  `${(apt.client?.firstName || apt.client_first_name || '').toString().trim()} ${(apt.client?.lastName || apt.client_last_name || '').toString().trim()}`.trim() ||
                                  (apt.client?.phone || apt.client_phone || apt.phone || '')
                              ));
                              return (
                                  <motion.div
                                      key={apt.id}
                                      initial={{ opacity: 0, y: 20 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0 }}
                                      onClick={() => setSelectedAppointment(apt)}
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
                                              setSelectedAppointment(apt);
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

                      {/* חסימות פעילות ליום הנבחר בלבד */}
                      {blocksForSelectedDay.length > 0 && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold text-gray-800">חסימות פעילות</h4>
                              <Button variant="outline" size="sm" onClick={reloadBlocks}>רענון</Button>
                            </div>

                            <div className="space-y-2">
                              {blocksForSelectedDay.map((blk) => {
                                const s = new Date(blk.start_at || blk.startAt);
                                const e = new Date(blk.end_at || blk.endAt);
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
                          <div className="divide-y divide-gray-200">
                            {clientDataWithAppointments.map((client) => {
                              const memberFlag = Boolean(client.isMember ?? client.is_member);
                              const first = client.first_name ?? client.firstName ?? (client.name?.split(' ')[0] ?? '');
                              const last  = client.last_name  ?? client.lastName  ?? (client.name?.split(' ').slice(1).join(' ') ?? '');
                              const phoneDisplay = client.phone ?? client.client_phone ?? '';
                              const lastAppointment = client.lastAppointmentDate ? format(new Date(client.lastAppointmentDate), 'dd/MM/yyyy', { locale: he }) : 'אין היסטוריה';
                              const lastClass = client.lastAppointmentDate
                                  ? (client.lastAppointmentRecent ? 'text-green-700' : 'text-red-700')
                                  : 'text-gray-800';
                              return (
                                  <div key={client.id} className="py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                      <p className="font-bold text-gray-900">{[first, last].filter(Boolean).join(' ')}</p>
                                      <p className="text-sm text-gray-600">{phoneDisplay}</p>
                                      {memberFlag && (
                                          <span className="mt-2 inline-block rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
                                            חבר מועדון
                                          </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-4">
                                      <div className="text-left md:text-right">
                                        <p className="text-sm text-gray-500">תור אחרון:</p>
                                        <p className={`font-medium ${lastClass}`}>{lastAppointment}</p>
                                      </div>
                                      <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => toggleClientMembership(client)}
                                          className={memberFlag ? 'border-emerald-600 text-emerald-700 hover:bg-emerald-50' : ''}
                                      >
                                        {memberFlag ? 'הסר ממועדון' : 'הפוך לחבר'}
                                      </Button>
                                    </div>
                                  </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                      <div className="fixed bottom-24 right-6 z-30">
                        <Button
                            onClick={() => setShowClientForm(true)}
                            className="w-12 h-12 rounded-full bg-black hover:bg-gray-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                          <Plus className="w-6 h-6" />
                        </Button>
                      </div>
                    </div>
                )}

                {activeTab === 'services' && (
                    <div className="space-y-6">
                      <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold">ניהול שירותים</h2>
                        <Button
                            onClick={() => setShowServiceForm(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-full"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          הוסף שירות
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
                                {services.map((service, index) => (
                                    <Draggable key={service.id} draggableId={service.id.toString()} index={index}>
                                      {(provided) => (
                                          <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                          >
                                            <Card className="bg-white rounded-2xl shadow-sm">
                                              <CardContent className="p-4">
                                                <div className="flex justify-between items-start mb-4">
                                                  <div className="flex items-center gap-2">
                                                    <div {...provided.dragHandleProps} className="cursor-grab text-gray-400">
                                                      <GripVertical />
                                                    </div>
                                                    <div>
                                                      <h3 className="font-bold text-lg">{service.name}</h3>
                                                      <p className="text-gray-600 text-sm">{service.description}</p>
                                                    </div>
                                                  </div>
                                                  <Badge className={service.active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                                                    {service.active ? "פעיל" : "לא פעיל"}
                                                  </Badge>
                                                </div>

                                                <div className="flex justify-between items-center mb-4">
                                                  <span className="font-bold text-lg">₪{service.price}</span>
                                                  <span className="text-gray-500 text-sm">{service.duration_minutes} דקות</span>
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
                                ))}
                                {provided.placeholder}
                              </div>
                          )}
                        </Droppable>
                      </DragDropContext>
                    </div>
                )}

                {activeTab === 'products' && (
                    <div className="space-y-6">
                      <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold">ניהול מוצרים</h2>
                        <Button
                            onClick={() => { setEditingProduct(null); setShowProductForm(true); }}
                            className="bg-orange-600 hover:bg-orange-700 text-white rounded-full"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          הוסף מוצר
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
                      <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold">ניהול סטוריז</h2>
                        <Button
                            onClick={() => setShowGalleryForm(true)}
                            className="bg-purple-600 hover:bg-purple-700 text-white rounded-full"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          הוסף סרטון
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
                      <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold">ניהול תגובות לקוחות</h2>
                        <Button
                            onClick={() => setShowTestimonialForm(true)}
                            className="bg-green-600 hover:bg-green-700 text-white rounded-full"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          הוסף תגובה
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

                                                <p className="text-gray-700 mb-4">"{testimonial.text}"</p>
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
                      <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold">ניהול סרטון הרקע</h2>
                        <Button
                            onClick={() => setShowBackgroundVideoForm(true)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          הוסף סרטון רקע
                        </Button>
                      </div>

                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {backgroundVideos.map((video) => (
                            <Card key={video.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                              <div className="aspect-video bg-gray-100">
                                <video
                                    src={
                                      video.video_url?.startsWith('http')
                                          ? video.video_url
                                          : `${(api?.defaults?.baseURL || '').replace(/\/+$/, '')}${video.video_url || ''}`
                                    }
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
                                      className={video.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                                    {video.is_active ? "פעיל" : "לא פעיל"}
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
                                      disabled={video.is_active}
                                  >
                                    {video.is_active ? "פעיל" : "הפעל"}
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
                        ))}
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
                  {[
                    { label: "הוספת תור", icon: Plus, action: () => { setShowQuickActionsModal(false); setShowAddAppointmentForm(true); } },
                    { label: "רשימת המתנה", icon: Clock, action: () => { setShowQuickActionsModal(false); setShowWaitingListView(true); } },
                    { label: "חסימת תורים", icon: Ban, action: () => { setShowQuickActionsModal(false); setShowBlockingForm(true); } },
                    { label: "הודעה ללקוחות", icon: MessageSquare, action: () => { setShowQuickActionsModal(false); setShowMessageModal(true); } },
                    { label: "בקשות לביטול", icon: XCircle, action: () => {
                        setShowQuickActionsModal(false);
                        alert("בקשות לביטול יתווסף בעדכון הבא למערכת!");
                      } }
                  ].map(item => (
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
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={() => setShowMessageModal(false)}>
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
                      onClick={() => setShowMessageModal(false)}
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
                        onClick={() => setShowMessageModal(false)}
                        variant="outline"
                        className="flex-1 rounded-full py-3"
                    >
                      ביטול
                    </Button>
                    <Button
                        onClick={() => {
                          alert("ההודעה נשלחה בהצלחה!");
                          setShowMessageModal(false);
                          setMessageText('');
                        }}
                        className="flex-1 bg-black text-white rounded-full py-3"
                        disabled={!messageText.trim()}
                    >
                      <Send className="w-4 h-4 ml-2" />
                      שלח הודעה
                    </Button>
                  </div>
                </div>
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

        {selectedAppointment && (
            <AppointmentActionsModal
                isOpen={!!selectedAppointment}
                onClose={() => setSelectedAppointment(null)}
                appointment={selectedAppointment}
                service={serviceById(selectedAppointment?.service_id)}
                onDelete={() => {
                  handleDelete(Appointment, selectedAppointment.id, "תור");
                  setSelectedAppointment(null);
                }}
                onStatusChange={handleStatusChange}
                onRescheduleRequest={() =>
                    handleRescheduleRequest(
                        selectedAppointment,
                        serviceById(selectedAppointment?.service_id)
                    )
                }
            />
        )}


        {selectedWaitingEntry && (
            <WaitingListActionModal
                isOpen={!!selectedWaitingEntry}
                onClose={() => setSelectedWaitingEntry(null)}
                entry={selectedWaitingEntry}
                service={services.find(s => s.id === selectedWaitingEntry.service_id)}
                appointments={appointments}
                onBooked={() => {
                  setSelectedWaitingEntry(null);
                  loadData();
                }}
            />
        )}


        {rescheduleData.isOpen && (
            <RescheduleModal
                isOpen={rescheduleData.isOpen}
                onCancel={() => setRescheduleData({ isOpen: false, appointment: null, service: null })}
                onSubmit={handleRescheduleSubmit}
                appointment={rescheduleData.appointment}
                service={rescheduleData.service}
                allAppointments={appointments}
                businessHours={businessHours}
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
    duration_minutes: service?.duration_minutes || 30,
    price: service?.price || 0,
    active: service?.active ?? true
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
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value)})}
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
              checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
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
    text: testimonial?.text || "",
    rating: testimonial?.rating || 5
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
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
              onChange={(e) => setFormData({ ...formData, text: e.target.value })}
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
      const { url } = await UploadFile.upload(file);

      // נבנה URL מוחלט לפי הבסיס של axios (api)
      const base = (api?.defaults?.baseURL || '').replace(/\/+$/,''); // בלי "/" בסוף
      const abs = url.startsWith('http') ? url : `${base}${url}`;      // "/uploads/..." -> "http://localhost:3001/uploads/..."

      await onSubmit({
        // נשמור את שלושתם כדי שכל מקום בקוד ימצא מה שהוא צריך:
        image_url: abs,
        video_url: abs,
        url:       abs,
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
      const { url } = await UploadFile.upload(file);
      await onSubmit({ video_url: url, image_url: url, url });
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