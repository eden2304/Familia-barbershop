import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const LiveRegionContext = createContext({
  announcePolite: () => {},
  announceAssertive: () => {},
});

export function LiveRegionProvider({ children }) {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');
  const timers = useRef([]);

  const queueReset = useCallback((setter) => {
    const id = window.setTimeout(() => setter(''), 1200);
    timers.current.push(id);
  }, []);

  const announcePolite = useCallback((message) => {
    if (!message) return;
    setPoliteMessage('');
    window.setTimeout(() => {
      setPoliteMessage(message);
      queueReset(setPoliteMessage);
    }, 10);
  }, [queueReset]);

  const announceAssertive = useCallback((message) => {
    if (!message) return;
    setAssertiveMessage('');
    window.setTimeout(() => {
      setAssertiveMessage(message);
      queueReset(setAssertiveMessage);
    }, 10);
  }, [queueReset]);

  const value = useMemo(() => ({ announcePolite, announceAssertive }), [announcePolite, announceAssertive]);

  return (
    <LiveRegionContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{politeMessage}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">{assertiveMessage}</div>
    </LiveRegionContext.Provider>
  );
}

export function useLiveRegion() {
  return useContext(LiveRegionContext);
}
