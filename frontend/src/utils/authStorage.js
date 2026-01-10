const AUTH_TOKEN_KEY = 'familiaAuthToken';

export function getStoredAuthToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; }
  catch { return ''; }
}

export function setStoredAuthToken(token) {
  try {
    if (!token) localStorage.removeItem(AUTH_TOKEN_KEY);
    else localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {}
}

export function clearStoredAuthToken() {
  try { localStorage.removeItem(AUTH_TOKEN_KEY); }
  catch {}
}
