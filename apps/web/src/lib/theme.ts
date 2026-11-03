import { useSyncExternalStore } from "react";

/**
 * E-6: system, light or dark. The choice lives in localStorage and on
 * `<html data-theme>`; the stylesheet does the rest. The meta theme-color
 * follows so the iOS status bar matches the paper.
 */
export type Theme = "system" | "light" | "dark";
export const THEMES: readonly Theme[] = ["system", "light", "dark"];

const KEY = "reeve.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function resolved(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme = read()): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved(theme) === "dark" ? "#0e0d0c" : "#f6f3ee";
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the attribute still applies for this session */
  }
  applyTheme(theme);
  for (const l of listeners) l();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
    () => "system" as const,
  );
}

/** Called once at boot, and again when the system preference flips under "system". */
export function watchTheme(): () => void {
  applyTheme();
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onChange = () => applyTheme();
  mql?.addEventListener("change", onChange);
  return () => mql?.removeEventListener("change", onChange);
}
