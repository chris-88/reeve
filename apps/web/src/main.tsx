import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import App from "./App";
import { cacheBuster, persister, queryClient, shouldPersistQuery } from "@/lib/query";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        buster: cacheBuster,
        dehydrateOptions: {
          // Never write anything derived from an auth response to disk.
          shouldDehydrateQuery: (q) => shouldPersistQuery(q.queryKey),
        },
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
