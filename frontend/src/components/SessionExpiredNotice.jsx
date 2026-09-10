import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { sessionExpiredEventName, requestOpenLogin } from '@/lib/sessionExpiredNotice';

export default function SessionExpiredNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onExpired = () => setOpen(true);
    window.addEventListener(sessionExpiredEventName, onExpired);
    return () => window.removeEventListener(sessionExpiredEventName, onExpired);
  }, []);

  if (!open) return null;

  const handleReconnect = () => {
    setOpen(false);
    const path = (typeof window !== 'undefined' && window.location.pathname) || '/';
    const onHome = path === '/' || /\/Home\/?$/i.test(path);
    if (onHome) {
      requestOpenLogin();
    } else {
      // לא בדף הבית (למשל נשארנו על /Admin) — נטען מחדש לדף הבית כדי שיתחבר משם
      window.location.assign('/');
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-center">
        <h2 className="text-xl font-bold text-gray-900">החיבור פג תוקף</h2>
        <p className="mt-3 leading-7 text-gray-600">
          מטעמי אבטחה נותקת מהמערכת. יש להתחבר מחדש כדי להמשיך.
        </p>
        <Button
          className="mt-5 w-full rounded-full bg-black py-3 font-medium text-white hover:bg-gray-800"
          onClick={handleReconnect}
        >
          התחברות מחדש
        </Button>
      </div>
    </div>
  );
}
