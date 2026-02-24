import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatRateLimitCountdown, rateLimitEventName } from '@/lib/rateLimitNotice';

export default function RateLimitPopup() {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    const onRateLimit = (event) => {
      const seconds = Math.max(1, Number.parseInt(event?.detail?.retryAfterSeconds, 10) || 60);
      setSecondsLeft(seconds);
    };

    window.addEventListener(rateLimitEventName, onRateLimit);
    return () => window.removeEventListener(rateLimitEventName, onRateLimit);
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  if (secondsLeft <= 0) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <Alert className="border-red-200 bg-red-50 text-center">
          <AlertDescription className="text-red-700">
            ביצעת יותר מדי בקשות. למען אבטחת המערכת ניתן לבצע שוב בקשות בעוד:
            <div className="mt-2 text-2xl font-bold" dir="ltr">{formatRateLimitCountdown(secondsLeft)}</div>
          </AlertDescription>
        </Alert>
        <Button
          className="mt-4 w-full"
          onClick={() => setSecondsLeft(0)}
        >
          הבנתי
        </Button>
      </div>
    </div>
  );
}
