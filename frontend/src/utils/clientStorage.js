const STORAGE_KEYS = ["familiaClient", "familia_client"];

function normalizeClientPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const firstName = String(raw.firstName ?? raw.first_name ?? "").trim();
  const lastName = String(raw.lastName ?? raw.last_name ?? "").trim();
  const phone = String(raw.phone ?? raw.client_phone ?? "").trim();
  const isMember = Boolean(raw.isMember ?? raw.is_member ?? false);
  const isAdmin = Boolean(raw.isAdmin ?? raw.is_admin ?? false);
  const fullName = `${firstName} ${lastName}`.trim();
  return {
    ...raw,
    phone,
    client_phone: phone,
    firstName,
    lastName,
    first_name: firstName,
    last_name: lastName,
    isMember,
    is_member: isMember,
    isAdmin,
    is_admin: isAdmin,
    client_name: raw.client_name ?? fullName,
    name: raw.name ?? fullName,
  };
}

export function readStoredClient() {
  if (typeof localStorage === "undefined") return null;
  for (const key of STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw || raw === "undefined") continue;
    try {
      return normalizeClientPayload(JSON.parse(raw));
    } catch {
      localStorage.removeItem(key);
    }
  }
  return null;
}

export function writeStoredClient(client, options = {}) {
  if (typeof localStorage === "undefined") return null;
  const normalized = normalizeClientPayload(client);
  if (!normalized) return null;
  const serialized = JSON.stringify(normalized);
  STORAGE_KEYS.forEach((key) => localStorage.setItem(key, serialized));
  if (options.dispatch !== false && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("familia-client-updated", { detail: normalized }));
    window.dispatchEvent(new Event("familia-auth-changed"));
  }
  return normalized;
}

export function clearStoredClient(options = {}) {
  if (typeof localStorage !== "undefined") {
    STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }
  if (options.dispatch !== false && typeof window !== "undefined") {
    window.dispatchEvent(new Event("familia-client-updated"));
    window.dispatchEvent(new Event("familia-auth-changed"));
  }
}
