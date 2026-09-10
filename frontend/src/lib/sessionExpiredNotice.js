const SESSION_EXPIRED_EVENT = 'familia-session-expired';
const OPEN_LOGIN_EVENT = 'familia-open-login';

let lastNoticeMs = 0;

// כמה בקשות מקבילות יכולות לחזור עם 401 באותו רגע (למשל טעינת פאנל הניהול);
// רוצים להציג הודעה אחת בלבד.
export const notifySessionExpired = () => {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastNoticeMs < 4000) return;
  lastNoticeMs = now;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
};

export const requestOpenLogin = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_LOGIN_EVENT));
};

export const sessionExpiredEventName = SESSION_EXPIRED_EVENT;
export const openLoginEventName = OPEN_LOGIN_EVENT;
