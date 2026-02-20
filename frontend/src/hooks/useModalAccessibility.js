import { useEffect } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function useModalAccessibility({ isOpen, containerRef, onClose }) {
  useEffect(() => {
    if (!isOpen || !containerRef?.current) return;

    const modalEl = containerRef.current;
    const previousFocused = document.activeElement;
    const focusables = modalEl.querySelectorAll(FOCUSABLE_SELECTOR);
    (focusables[0] || modalEl).focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR));
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocused instanceof HTMLElement) previousFocused.focus();
    };
  }, [isOpen, containerRef, onClose]);
}
