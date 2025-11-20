export const AUTH_TOKEN_STORAGE_KEY = 'familiaAuthToken';

export function getStoredAuthToken() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || localStorage.getItem('token');
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!token) {
      clearStoredAuth();
      return;
    }
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    localStorage.removeItem('token');
  } catch {
    // ignore storage errors
  }
}

export function clearStoredAuth() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem('token');
  } catch {
    // ignore
  }
}
