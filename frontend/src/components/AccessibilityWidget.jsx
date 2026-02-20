import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accessibility,
  Bold,
  Contrast,
  Eraser,
  Eye,
  Heading,
  Link as LinkIcon,
  Minus,
  X,
  MousePointer2,
  PauseCircle,
  Plus,
  RefreshCcw,
  Rows3,
  SunMoon,
  Type,
  WholeWord,
  Languages,
  Focus,
} from "lucide-react";
import "@/components/AccessibilityWidget.css";
import {
  defaultA11ySettings,
  applyA11ySettings,
  loadA11ySettings,
  saveA11ySettings,
  resetA11ySettings,
} from "@/lib/accessibility";

const FONT_MIN = 80;
const FONT_MAX = 160;
const FONT_STEP = 10;

function TileButton({ icon: Icon, label, onClick, active, pressed }) {
  return (
    <button
      type="button"
      className={`a11y-widget__tile ${active ? "is-active" : ""}`}
      onClick={onClick}
      aria-pressed={pressed}
    >
      <Icon aria-hidden="true" className="a11y-widget__tile-icon" />
      <span>{label}</span>
    </button>
  );
}

export default function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(defaultA11ySettings);
  const [guideY, setGuideY] = useState(220);
  const launcherRef = useRef(null);
  const panelRef = useRef(null);
  const lastFocusedRef = useRef(null);

  useEffect(() => {
    const loaded = loadA11ySettings();
    setSettings(loaded);
    applyA11ySettings(loaded);
  }, []);

  useEffect(() => {
    applyA11ySettings(settings);
    saveA11ySettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!open) return;

    lastFocusedRef.current = document.activeElement;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== "Tab" || !first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    const restoreTarget = lastFocusedRef.current;
    if (restoreTarget instanceof HTMLElement) {
      restoreTarget.focus();
      return;
    }
    launcherRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!settings.readingGuide) return;

    const onMove = (event) => setGuideY(event.clientY);
    const onTouch = (event) => {
      const touch = event.touches?.[0];
      if (touch) setGuideY(touch.clientY);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [settings.readingGuide]);

  const setToggle = (key) => setSettings((prev) => ({ ...prev, [key]: !prev[key] }));

  const decreaseFont = () => {
    setSettings((prev) => ({
      ...prev,
      fontScale: Math.max(FONT_MIN, prev.fontScale - FONT_STEP),
    }));
  };

  const increaseFont = () => {
    setSettings((prev) => ({
      ...prev,
      fontScale: Math.min(FONT_MAX, prev.fontScale + FONT_STEP),
    }));
  };

  const resetAll = () => {
    resetA11ySettings();
    setSettings(defaultA11ySettings);
  };

  const contentTiles = useMemo(
    () => [
      { key: "dyslexicFont", label: "פונט לדיסלקטים", icon: Type },
      { key: "highlightLinks", label: "הדגש קישורים", icon: LinkIcon },
      { key: "highlightHeadings", label: "הדגש כותרות", icon: Heading },
      { key: "bold", label: "משקל הפונט", icon: Bold },
      { key: "lineHeight", label: "גובה שורה", icon: Rows3 },
      { key: "letterSpacing", label: "מרווח בין אותיות", icon: WholeWord },
    ],
    []
  );

  const colorTiles = useMemo(
    () => [
      { key: "highContrast", label: "ניגודיות גבוהה", icon: Contrast },
      { key: "invert", label: "ניגודיות בהירה", icon: SunMoon },
      { key: "monochrome", label: "מונוכרום", icon: Eye },
      { key: "lowSaturation", label: "רווי צבע נמוך", icon: Focus },
    ],
    []
  );

  const toolTiles = useMemo(
    () => [
      { key: "bigCursor", label: "סמן גדול", icon: MousePointer2 },
      { key: "reduceMotion", label: "עצירת אנימציות", icon: PauseCircle },
      { key: "readingGuide", label: "מדריך קריאה", icon: Accessibility },
      { key: "focusVisible", label: "הדגשת פוקוס", icon: Eye },
    ],
    []
  );

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="a11y-widget__launcher"
        onClick={() => setOpen(true)}
        aria-label="פתיחת תפריט נגישות"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="a11y-widget-panel"
      >
        <Accessibility aria-hidden="true" />
      </button>

      {settings.readingGuide && (
        <div className="a11y-widget__reading-guide" style={{ top: `${guideY}px` }} aria-hidden="true" />
      )}

      {open && (
        <div className="a11y-widget__overlay" role="presentation" onClick={() => setOpen(false)}>
          <section
            id="a11y-widget-panel"
            className="a11y-widget__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="a11y-widget-title"
            ref={panelRef}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="a11y-widget__header">
              <div className="a11y-widget__header-actions">
                <button type="button" className="a11y-widget__circle-btn" aria-label="סגירה" onClick={() => setOpen(false)}>
                  <X aria-hidden="true" />
                </button>
                <button type="button" className="a11y-widget__circle-btn" aria-label="איפוס מהיר" onClick={resetAll}>
                  <RefreshCcw aria-hidden="true" />
                </button>
              </div>
              <h2 id="a11y-widget-title">תפריט נגישות</h2>
            </header>

            <div className="a11y-widget__lang-row" role="group" aria-label="בחירת שפה">
              <Languages aria-hidden="true" />
              <span>עברית (Hebrew)</span>
            </div>

            <div className="a11y-widget__section">
              <h3>התאמות תוכן</h3>
              <div className="a11y-widget__font-size">
                <div className="a11y-widget__font-label">התאם גודל פונט</div>
                <div className="a11y-widget__font-controls">
                  <button type="button" className="a11y-widget__circle-btn" onClick={increaseFont} aria-label="הגדלת טקסט">
                    <Plus aria-hidden="true" />
                  </button>
                  <strong aria-live="polite">{settings.fontScale}%</strong>
                  <button type="button" className="a11y-widget__circle-btn" onClick={decreaseFont} aria-label="הקטנת טקסט">
                    <Minus aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="a11y-widget__grid">
                {contentTiles.map((tile) => (
                  <TileButton
                    key={tile.key}
                    icon={tile.icon}
                    label={tile.label}
                    active={settings[tile.key]}
                    pressed={settings[tile.key]}
                    onClick={() => setToggle(tile.key)}
                  />
                ))}
              </div>
            </div>

            <div className="a11y-widget__section">
              <h3>התאמות צבע</h3>
              <div className="a11y-widget__grid">
                {colorTiles.map((tile) => (
                  <TileButton
                    key={tile.key}
                    icon={tile.icon}
                    label={tile.label}
                    active={settings[tile.key]}
                    pressed={settings[tile.key]}
                    onClick={() => setToggle(tile.key)}
                  />
                ))}
              </div>
            </div>

            <div className="a11y-widget__section">
              <h3>כלים</h3>
              <div className="a11y-widget__grid">
                {toolTiles.map((tile) => (
                  <TileButton
                    key={tile.key}
                    icon={tile.icon}
                    label={tile.label}
                    active={settings[tile.key]}
                    pressed={settings[tile.key]}
                    onClick={() => setToggle(tile.key)}
                  />
                ))}
              </div>
            </div>

            <button type="button" className="a11y-widget__reset" onClick={resetAll}>
              <Eraser aria-hidden="true" />
              איפוס הגדרות
            </button>

          </section>
        </div>
      )}
    </>
  );
}
