import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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

  return (
    <SystemPopupContext.Provider value={contextValue}>
      {children}
      <AlertDialog
        open={Boolean(popupState)}
        onOpenChange={(open) => {
          if (!open) {
            closePopup(popupState?.mode === "confirm" ? false : true);
          }
        }}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border-0 bg-white p-0 text-right shadow-2xl" dir="rtl">
          <div className="space-y-5 p-6">
            <AlertDialogHeader className="space-y-2 text-center sm:text-center">
              <AlertDialogTitle className="text-2xl font-black text-slate-900">
                {popupState?.title}
              </AlertDialogTitle>
              <AlertDialogDescription className="whitespace-pre-line text-base leading-7 text-slate-600">
                {popupState?.description}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="flex-col-reverse gap-3 sm:flex-col-reverse sm:space-x-0">
              {popupState?.mode === "confirm" && (
                <AlertDialogCancel className="mt-0 h-12 rounded-2xl border-slate-200 text-base font-semibold">
                  {popupState?.cancelText}
                </AlertDialogCancel>
              )}
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  closePopup(true);
                }}
                className="h-12 rounded-2xl bg-slate-950 text-base font-semibold text-white hover:bg-slate-800"
              >
                {popupState?.confirmText}
              </AlertDialogAction>
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
