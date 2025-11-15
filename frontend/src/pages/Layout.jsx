import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { User, Home as HomeIcon, History, Navigation, Phone, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence } from "framer-motion";
import ClientWelcomeBanner from "@/components/ClientWelcomeBanner";
import { SidebarProvider, useSidebar } from "@/components/SidebarContext";
// Admin phone numbers - only these users will see the admin button
const ADMIN_PHONE_NUMBERS = ['0537002171', '0523767851'];

// Phone normalization function
const normalizePhone = (phone) => {
  if (!phone) return "";
  const cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.startsWith('972')) return `0${cleaned.substring(3)}`;
  if (cleaned.length === 9 && cleaned.startsWith('5')) return `0${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith('0')) return cleaned;
  return cleaned.startsWith('0') ? cleaned : `0${cleaned}`;
};

// Internal component to consume context and render the layout
function MainLayout({ children, currentPageName }) {
  const { setSidebarOpen } = useSidebar();
  const [client, setClient] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);

  useEffect(() => {
    const checkLoginState = () => {
      const storedClient = localStorage.getItem('familiaClient');
      let parsedClient = null;
      try {
        if (storedClient && storedClient !== "undefined") {
          parsedClient = JSON.parse(storedClient);
        }
        else if (storedClient === "undefined") {
          localStorage.removeItem('familiaClient');
        }
      } catch {
        localStorage.removeItem('familiaClient');
      }
      if (parsedClient) {
        setClient(parsedClient);
        const clientPhone = normalizePhone(parsedClient.phone);
        setIsAdmin(ADMIN_PHONE_NUMBERS.includes(clientPhone));
        if (sessionStorage.getItem('justLoggedIn') === 'true') {
          setShowWelcomeBanner(true);
          sessionStorage.removeItem('justLoggedIn');
        }
      } else {
        setClient(null);
        setIsAdmin(false);
      }
    };

    checkLoginState();
  }, []);

  const handleCallClick = (e) => {
    e.preventDefault();
    window.location.href = "tel:+972523767851";
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900" dir="rtl">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;500;600;700;800&display=swap');
        * {
          font-family: 'Assistant', sans-serif;
        }
        body { 
          background-color: #f9fafb; 
          margin: 0;
          padding: 0;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .main-content {
          padding-bottom: 100px; /* Space for bottom nav */
          min-height: calc(100vh - 100px);
        }
      `}</style>
      <AnimatePresence>
        {showWelcomeBanner && client && <ClientWelcomeBanner onClose={() => setShowWelcomeBanner(false)} />}
      </AnimatePresence>

      <nav className="fixed top-4 left-4 right-4 z-50 bg-black rounded-full px-6 py-3 shadow-2xl pointer-events-none">
        <div className="flex items-center justify-between max-w-7xl mx-auto h-12 relative">
          <div className="w-10 h-10 flex items-center justify-center relative z-20">
            {isAdmin && currentPageName === 'Admin' ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(prev => !prev)}
                className="text-white hover:text-gray-300 relative z-20 pointer-events-auto"
              >
                <Menu className="w-6 h-6" />
              </Button>
            ) : isAdmin ? (
              <Link
                to={createPageUrl("Admin")}
                className="p-2 text-white hover:text-gray-300 rounded-full transition-colors relative z-20 pointer-events-auto"
              >
                <User className="w-6 h-6" />
              </Link>
            ) : (
              <div />
            )}
          </div>

          <Link
            to={createPageUrl('Home')}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center select-none pointer-events-auto"
          >
            <img
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/7a0e19259_logo.png"
              alt="Familia Logo"
              className="h-10 w-auto max-w-[200px] object-contain"
              draggable={false}
            />
          </Link>

          <div className="w-10 h-10" /> 
        </div>
      </nav>

      <main className="main-content">
        {children}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 z-50">
        <div className="flex justify-around items-center py-4 px-4">
          <Link to="/" className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentPageName === 'Home' ? 'text-black' : 'text-gray-500 hover:text-black'}`}>
            <HomeIcon className="w-6 h-6"/>
            <span className="text-xs font-medium">בית</span>
          </Link>
          
          <Link to="/MyAppointmentsPage" className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${currentPageName === 'MyAppointmentsPage' ? 'text-black' : 'text-gray-500 hover:text-black'}`}>
            <History className="w-6 h-6"/>
            <span className="text-xs font-medium">התורים שלי</span>
          </Link>
          
          <a href="https://waze.com/ul?q=הסתדרות%20201%20חולון" target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors text-gray-500 hover:text-black">
            <Navigation className="w-6 h-6"/>
            <span className="text-xs font-medium">איך מגיעים</span>
          </a>
          
          <button onClick={handleCallClick} className="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors text-gray-500 hover:text-black">
            <Phone className="w-6 h-6"/>
            <span className="text-xs font-medium">צור קשר</span>
          </button>
        </div>
      </footer>
    </div>
  );
}


export default function Layout({ children, currentPageName }) {
  return (
    <SidebarProvider>
      <MainLayout currentPageName={currentPageName}>
        {children}
      </MainLayout>
    </SidebarProvider>
  );
}

