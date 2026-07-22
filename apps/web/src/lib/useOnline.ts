import { useEffect, useState } from "react";

/**
 * Whether the browser believes it has a network.
 *
 * A hook rather than a bare `navigator.onLine` read, so the UI re-renders when
 * connectivity changes instead of showing whatever was true at mount.
 *
 * This is for *display* only. The outbox deliberately does not gate a flush on
 * `navigator.onLine`, because it reports true behind a captive portal and false
 * during some VPN transitions — as a gate it blocks syncs that would have
 * worked. Telling the user what is going on is a different job from deciding
 * whether to try.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}
