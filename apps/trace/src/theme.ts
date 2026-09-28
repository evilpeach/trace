import { setTheme as setNativeTheme } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "trace:appearance:v1";

let snapshot: { preference: ThemePreference; resolved: ResolvedTheme } = {
  preference: "system",
  resolved: "light",
};
let initialized = false;
let systemTheme: MediaQueryList;
let nativeUpdates = Promise.resolve();
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage can be unavailable in a private browser session.
  }
  return "system";
}

function applyAppearance(preference: ThemePreference) {
  const resolved =
    preference === "system"
      ? systemTheme.matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolved;
  if (snapshot.preference === preference && snapshot.resolved === resolved)
    return;
  snapshot = { preference, resolved };
  listeners.forEach((listener) => listener());
}

function syncNativeAppearance(preference: ThemePreference) {
  if (!isTauri()) return;
  // Keep rapid selections ordered; null releases macOS's app-level override.
  nativeUpdates = nativeUpdates
    .then(() => setNativeTheme(preference === "system" ? null : preference))
    .catch((error: unknown) => {
      console.warn("Could not update the native window appearance", error);
    });
}

/** Apply the saved appearance before React paints, once per app lifetime. */
export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const preference = readPreference();
  applyAppearance(preference);
  syncNativeAppearance(preference);
  systemTheme.addEventListener("change", () => {
    if (snapshot.preference === "system") applyAppearance("system");
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    const next = readPreference();
    applyAppearance(next);
    syncNativeAppearance(next);
  });
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The selection still works for this session when persistence is blocked.
  }
  applyAppearance(preference);
  syncNativeAppearance(preference);
}

export const getThemeSnapshot = () => snapshot;
export function subscribeToTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
