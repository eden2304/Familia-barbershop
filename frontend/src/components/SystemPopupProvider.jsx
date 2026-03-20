import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SystemPopupContext = createContext(null);

const DEFAULT_ALERT_TITLE = "הודעת מערכת";
const DEFAULT_CONFIRM_TITLE = "אישור פעולה";

function normalizeOptions(input, fallbackTitle) {
  if (typeof input === "string") {
    return { description: input, title: fallbackTitle };
  }

  return {
    title: input?.title || fallbackTitle,
    description: input?.description || "",
    confirmText: input?.confirmText,
    cancelText: input?.cancelText,
    variant: input?.variant,
  };
}

export function SystemPopupProvider({ children }) {
  const [popupState, setPopupState] = useState(null);
  const resolverRef = useRef(null);

  const closePopup = useCallback((value) => {
    if (resolverRef.current) {
      resolverRef.current(value);
      resolverRef.current = null;
    }
    setPopupState(null);
  }, []);

  const showAlert = useCallback((input) => new Promise((resolve) => {
    const options = normalizeOptions(input, DEFAULT_ALERT_TITLE);
    resolverRef.current = resolve;
    setPopupState({
      mode: "alert",
      title: options.title,
      description: options.description,
      confirmText: options.confirmText || "אישור",
    });
  }), []);

  const showConfirm = useCallback((input) => new Promise((resolve) => {
    const options = normalizeOptions(input, DEFAULT_CONFIRM_TITLE);
    resolverRef.current = resolve;
    setPopupState({
      mode: "confirm",
      title: options.title,
      description: options.description,
      confirmText: options.confirmText || "אישור",
      cancelText: options.cancelText || "ביטול",
      variant: options.variant || "default",
    });
  }), []);

  const contextValue = useMemo(() => ({ showAlert, showConfirm }), [showAlert, showConfirm]);
  const dismissValue = popupState?.mode === "confirm" ? false : true;

  return (
    <SystemPopupContext.Provider value={contextValue}>
      {children}
      <AlertDialog
        open={Boolean(popupState)}
        onOpenChange={(open) => {
          if (!open) {
            closePopup(dismissValue);
          }
        }}
      >
        <AlertDialogContent
          className="w-[min(calc(100vw-32px),22rem)] rounded-[24px] border-0 bg-white p-0 text-right shadow-2xl"
          dir="rtl"
        >
          <div className="relative space-y-3 px-5 pb-4 pt-3 sm:px-6 sm:pb-5 sm:pt-4">
            <button
              type="button"
              onClick={() => closePopup(dismissValue)}
              className="absolute right-3 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="סגור חלון"
            >
              <X className="h-4 w-4" />
            </button>

            <AlertDialogHeader className="space-y-1 pt-4 text-center sm:text-center">
              <AlertDialogTitle className="text-lg font-extrabold text-slate-900 sm:text-[1.2rem]">
                {popupState?.title}
              </AlertDialogTitle>
              <AlertDialogDescription className="mx-auto max-w-[17rem] whitespace-pre-line text-[0.97rem] leading-6 text-slate-600 sm:text-base">
                {popupState?.description}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className={`pt-1 ${popupState?.mode === "confirm" ? "grid grid-cols-2 gap-2 sm:grid-cols-2" : "flex items-center justify-center"}`}>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  closePopup(true);
                }}
                className={`h-10 rounded-xl bg-slate-950 px-6 text-sm font-semibold text-white hover:bg-slate-800 ${popupState?.mode === "confirm" ? "w-full" : "min-w-28"}`}
              >
                {popupState?.confirmText}
              </AlertDialogAction>
              {popupState?.mode === "confirm" && (
                <AlertDialogCancel className="mt-0 h-10 w-full rounded-xl border-slate-200 px-5 text-sm font-medium">
                  {popupState?.cancelText}
                </AlertDialogCancel>
              )}
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </SystemPopupContext.Provider>
  );
}

export function useSystemPopup() {
  const context = useContext(SystemPopupContext);

  if (!context) {
    throw new Error("useSystemPopup must be used within SystemPopupProvider");
  }

  return context;
}
