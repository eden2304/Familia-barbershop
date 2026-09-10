// Biometric (WebAuthn / passkey) login helpers.
//
// The server still owns identity: a client proves who they are once via the
// WhatsApp OTP flow, then enrolls the phone's platform authenticator (Face ID /
// Touch ID / fingerprint / Windows Hello). Every later login on that device is a
// signature check — no WhatsApp message sent.

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// Remembers the last phone that enrolled a passkey *on this device*, so the login
// screen can lead with the biometric button instead of the phone field.
const HINT_KEY = 'familiaBiometricHint';

export function getBiometricHint() {
  try {
    return localStorage.getItem(HINT_KEY) || '';
  } catch {
    return '';
  }
}

export function setBiometricHint(phone) {
  try {
    if (phone) localStorage.setItem(HINT_KEY, String(phone));
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // ignore storage failures
  }
}

export function clearBiometricHint() {
  setBiometricHint('');
}

let _supportCache;
export async function isBiometricSupported() {
  if (typeof _supportCache === 'boolean') return _supportCache;
  try {
    if (typeof window === 'undefined' || !browserSupportsWebAuthn()) {
      _supportCache = false;
      return false;
    }
    _supportCache = await platformAuthenticatorIsAvailable();
  } catch {
    _supportCache = false;
  }
  return _supportCache;
}

async function apiPost(path, body, token) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = new Error(payload?.message || payload?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function describeDevice() {
  try {
    const ua = navigator.userAgent || '';
    if (/iphone/i.test(ua)) return 'iPhone';
    if (/ipad/i.test(ua)) return 'iPad';
    if (/android/i.test(ua)) return 'Android';
    if (/mac/i.test(ua)) return 'Mac';
    if (/windows/i.test(ua)) return 'Windows';
    return 'מכשיר';
  } catch {
    return 'מכשיר';
  }
}

// Enroll the current device. Requires a fresh access token from a successful
// login/registration. Throws on failure; the caller decides whether to surface it.
export async function enrollBiometric({ token, phone }) {
  if (!token) throw new Error('MISSING_TOKEN');
  const { challengeId, options } = await apiPost('/auth/webauthn/register/options', {}, token);
  const attestation = await startRegistration({ optionsJSON: options });
  await apiPost(
    '/auth/webauthn/register/verify',
    { challengeId, response: attestation, deviceLabel: describeDevice() },
    token,
  );
  if (phone) setBiometricHint(phone);
  return true;
}

// Attempt a full biometric login. Returns the same payload shape as
// POST /auth/verify-code. `phone` is optional — without it the browser offers any
// discoverable passkey for this site.
export async function loginWithBiometric({ phone } = {}) {
  const body = phone ? { phone } : {};
  const optionsRes = await apiPost('/auth/webauthn/login/options', body);
  const { challengeId, options } = optionsRes;
  const assertion = await startAuthentication({ optionsJSON: options });
  // No rememberMe — mirror the WhatsApp OTP flow exactly (access token only,
  // kept in localStorage). Avoids the refresh-token path entirely.
  return apiPost('/auth/webauthn/login/verify', {
    challengeId,
    response: assertion,
  });
}

// True when the user actively dismissed the passkey sheet — used to stay quiet
// instead of showing a scary error.
export function isUserCancellation(err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  return (
    name === 'NotAllowedError' ||
    name === 'AbortError' ||
    /timed out|not allowed|cancel/i.test(msg)
  );
}
