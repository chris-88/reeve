import { useCallback, useSyncExternalStore } from "react";

/**
 * Reactive media query, so a resize or rotation swaps the layout rather than
 * leaving whichever branch happened to mount first.
 *
 * useSyncExternalStore rather than useState + useEffect: matchMedia *is* an
 * external store, and mirroring it into state guarantees a render where the
 * two disagree.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // No viewport when prerendered: assume the phone-first branch.
    () => false,
  );
}
