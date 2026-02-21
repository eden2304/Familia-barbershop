export const A11Y_STORAGE_KEY = "familia_a11y_settings_v1";

export const defaultA11ySettings = {
  fontScale: 100,
  bold: false,
  lineHeight: false,
  letterSpacing: false,
  highlightHeadings: false,
  highlightLinks: false,
  dyslexicFont: false,
  highContrast: false,
  lowSaturation: false,
  monochrome: false,
  invert: false,
  readingGuide: false,
  reduceMotion: false,
  bigCursor: false,
  focusVisible: false,
  highlightForms: false,
};

const SCALE_CLASSES = [80, 90, 100, 110, 120, 130, 140, 150, 160].map((scale) => `a11y-font-scale-${scale}`);

const TOGGLE_CLASS_MAP = {
  bold: "a11y-bold",
  lineHeight: "a11y-line-height",
  letterSpacing: "a11y-letter-spacing",
  highlightLinks: "a11y-highlight-links",
  highlightHeadings: "a11y-highlight-headings",
  dyslexicFont: "a11y-dyslexic-font",
  highContrast: "a11y-contrast-high",
  lowSaturation: "a11y-saturation-low",
  monochrome: "a11y-monochrome",
  invert: "a11y-invert",
  reduceMotion: "a11y-reduce-motion",
  bigCursor: "a11y-big-cursor",
  focusVisible: "a11y-focus-visible",
  highlightForms: "a11y-highlight-forms",
};

export function normalizeA11ySettings(value) {
  return {
    ...defaultA11ySettings,
    ...value,
    fontScale: Number.isFinite(Number(value?.fontScale))
      ? Math.max(80, Math.min(160, Math.round(Number(value.fontScale) / 10) * 10))
      : defaultA11ySettings.fontScale,
  };
}

export function loadA11ySettings() {
  if (typeof window === "undefined") return defaultA11ySettings;
  try {
    const parsed = JSON.parse(localStorage.getItem(A11Y_STORAGE_KEY) || "null");
    return normalizeA11ySettings(parsed || {});
  } catch {
    return defaultA11ySettings;
  }
}

export function saveA11ySettings(settings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(settings));
}

export function applyA11ySettings(settings) {
  if (typeof document === "undefined") return;
  const normalized = normalizeA11ySettings(settings);
  const html = document.documentElement;

  html.classList.remove(...SCALE_CLASSES);
  const scaleClass = `a11y-font-scale-${normalized.fontScale}`;
  html.classList.add(scaleClass);
  html.style.setProperty("--a11y-font-scale", `${normalized.fontScale / 100}`);

  Object.entries(TOGGLE_CLASS_MAP).forEach(([settingKey, className]) => {
    html.classList.toggle(className, Boolean(normalized[settingKey]));
  });

  const filters = [];
  if (normalized.highContrast) filters.push("contrast(1.45)");
  if (normalized.lowSaturation) filters.push("saturate(0.55)");
  if (normalized.monochrome) filters.push("grayscale(1)");
  if (normalized.invert) filters.push("invert(1) hue-rotate(180deg)");
  html.style.setProperty("--a11y-filter", filters.join(" ") || "none");

}

export function resetA11ySettings() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(A11Y_STORAGE_KEY);
  }
  applyA11ySettings(defaultA11ySettings);
}
