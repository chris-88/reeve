import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";

const CACHE_KEY = "reeve.query-cache.v1";

/**
 * Persisted query cache.
 *
 * Without this the offline inbox is not merely stale, it is wrong: TanStack
 * Query's default networkMode pauses queries when offline rather than loading
 * them, so isLoading is false, execution falls through to the empty state, and
 * the app tells someone who has been capturing all week that they have no
 * captures at all.
 *
 * IndexedDB rather than localStorage: the capture list will outgrow the ~5 MB
 * practical limit, and localStorage writes block the main thread.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: 2,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get<string>(key)) ?? null,
    setItem: async (key, value) => set(key, value),
    removeItem: async (key) => del(key),
  },
  key: CACHE_KEY,
  throttleTime: 2000,
});

/**
 * Tied to the build. A schema change must not be able to resurrect rows shaped
 * for a previous version — busting is cheaper than migrating a cache.
 */
export const cacheBuster = __BUILD_ID__;

/** Only these are ever written to disk. Never anything derived from auth. */
export const shouldPersistQuery = (key: readonly unknown[]): boolean =>
  key[0] === "captures" || key[0] === "areas";

/** Called on sign-out: cached rows must not survive into another session. */
export async function purgeQueryCache(): Promise<void> {
  queryClient.clear();
  try {
    await del(CACHE_KEY);
  } catch {
    /* nothing useful to do */
  }
}
