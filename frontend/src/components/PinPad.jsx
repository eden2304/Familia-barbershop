import React, { useEffect, useRef } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { Check, Delete } from "lucide-react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const vibrate = (pattern) => {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    // ignore
  }
};

/**
 * iPhone-style numeric passcode pad.
 *
 * Fixed length  (`length`):           auto-submits via onComplete when full.
 * Variable length (`minLength`..`maxLength`): shows a confirm key, enabled once
 *   minLength digits are entered; dots beyond minLength are drawn as optional.
 *
 * `errorKey` — change it to play the "wrong code" shake.
 * Physical keyboard digits / Backspace / Enter also work (desktop).
 */
export default function PinPad({
  value,
  onChange,
  onComplete,
  length,
  minLength = 4,
  maxLength = 6,
  disabled = false,
  errorKey = 0,
}) {
  const fixed = Number.isInteger(length) && length > 0;
  const max = fixed ? length : maxLength;
  const min = fixed ? length : minLength;
  const controls = useAnimationControls();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!errorKey) return;
    vibrate([30, 40, 30]);
    controls.start({ x: [0, -14, 14, -10, 10, -5, 5, 0], transition: { duration: 0.45 } });
  }, [errorKey, controls]);

  const press = (digit) => {
    if (disabled || value.length >= max) return;
    vibrate(8);
    const next = value + digit;
    onChange(next);
    if (fixed && next.length === max) onComplete?.(next);
  };

  const backspace = () => {
    if (disabled || !value) return;
    vibrate(8);
    onChange(value.slice(0, -1));
  };

  const confirm = () => {
    if (disabled || value.length < min) return;
    onComplete?.(value);
  };

  // keep latest handlers for the keyboard listener
  const handlersRef = useRef({ press, backspace, confirm });
  handlersRef.current = { press, backspace, confirm };

  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        handlersRef.current.press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handlersRef.current.backspace();
      } else if (e.key === "Enter" && !fixed) {
        e.preventDefault();
        handlersRef.current.confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fixed]);

  const keyClass =
    "h-[72px] w-[72px] rounded-full bg-gray-100 text-[28px] font-medium text-gray-900 " +
    "flex items-center justify-center select-none transition-colors duration-100 " +
    "active:bg-gray-300 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-black";

  return (
    <div className="flex flex-col items-center" dir="ltr">
      {/* dots */}
      <motion.div animate={controls} className="mb-8 flex h-4 items-center justify-center gap-4" aria-live="polite">
        {Array.from({ length: max }).map((_, i) => {
          const filled = i < value.length;
          const optional = !fixed && i >= min;
          return (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full border-2 transition-all duration-150 ${
                filled
                  ? "scale-110 border-black bg-black"
                  : optional
                    ? "border-dashed border-gray-300 bg-transparent"
                    : "border-gray-400 bg-transparent"
              }`}
            />
          );
        })}
        <span className="sr-only">{`${value.length} ספרות הוזנו`}</span>
      </motion.div>

      {/* keypad */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        {KEYS.map((k) => (
          <button key={k} type="button" className={keyClass} onClick={() => press(k)} disabled={disabled} aria-label={k}>
            {k}
          </button>
        ))}

        {fixed ? (
          <span className="h-[72px] w-[72px]" aria-hidden="true" />
        ) : (
          <button
            type="button"
            onClick={confirm}
            disabled={disabled || value.length < min}
            aria-label="אישור"
            className="h-[72px] w-[72px] rounded-full bg-black text-white flex items-center justify-center transition-opacity duration-150 active:bg-gray-800 disabled:opacity-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            <Check className="h-7 w-7" />
          </button>
        )}

        <button type="button" className={keyClass} onClick={() => press("0")} disabled={disabled} aria-label="0">
          0
        </button>

        <button
          type="button"
          onClick={backspace}
          disabled={disabled || !value}
          aria-label="מחיקה"
          className="h-[72px] w-[72px] rounded-full flex items-center justify-center text-gray-700 transition-colors duration-100 active:bg-gray-100 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
        >
          <Delete className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}

export function isWeakPin(pin) {
  if (!/^\d{4,6}$/.test(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = pin.split("").map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  return ["1212", "121212", "1122", "112233", "2580", "0852"].includes(pin);
}
