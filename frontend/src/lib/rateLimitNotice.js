const RATE_LIMIT_EVENT = 'familia-rate-limit';

export const formatRateLimitCountdown = (totalSeconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

export const pickRetryAfterSeconds = ({ retryAfterHeader, retryAfterPayload, fallbackSeconds = 60 } = {}) => {
  const fromPayload = Number.parseInt(retryAfterPayload, 10);
  if (Number.isFinite(fromPayload) && fromPayload > 0) return fromPayload;

  const fromHeader = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;

  return Math.max(1, Number.parseInt(fallbackSeconds, 10) || 60);
};

export const notifyRateLimited = (retryAfterSeconds) => {
  if (typeof window === 'undefined') return;
  const seconds = Math.max(1, Number.parseInt(retryAfterSeconds, 10) || 60);
  window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: { retryAfterSeconds: seconds } }));
};

export const rateLimitEventName = RATE_LIMIT_EVENT;
