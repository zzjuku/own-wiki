// App-wide error banner.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { errorText } from "./api";

const NotifyContext = createContext<(e: unknown) => void>(() => {});

export const useReportError = () => useContext(NotifyContext);

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const report = useCallback((e: unknown) => {
    console.error(e);
    setMessage(errorText(e));
  }, []);
  return (
    <NotifyContext.Provider value={report}>
      {message && (
        <div className="banner" role="alert">
          <span>{message}</span>
          <button className="plain" onClick={() => setMessage(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {children}
    </NotifyContext.Provider>
  );
}
