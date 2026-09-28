import { useSyncExternalStore } from "react";
import {
  defaultShortcuts,
  normalizeShortcuts,
  type ShortcutBindings,
} from "./shortcuts";

export interface Preferences {
  uiFontSize: number;
  codeFontSize: number;
  autoDetect: boolean;
  diffLayout: "split" | "unified";
  wrapCode: boolean;
  sidebarCollapsed: boolean;
  shortcuts: ShortcutBindings;
}
export const PREFERENCES_KEY = "trace:preferences:v1";
export const defaultPreferences: Preferences = {
  uiFontSize: 15,
  codeFontSize: 13,
  autoDetect: true,
  diffLayout: "split",
  wrapCode: true,
  sidebarCollapsed: false,
  shortcuts: defaultShortcuts,
};
export function normalizePreferences(value: unknown): Preferences {
  const raw =
    value && typeof value === "object" ? (value as Partial<Preferences>) : {};
  const size = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback;
  return {
    uiFontSize: size(raw.uiFontSize, 15, 14, 18),
    codeFontSize: size(raw.codeFontSize, 13, 12, 18),
    autoDetect: typeof raw.autoDetect === "boolean" ? raw.autoDetect : true,
    diffLayout: raw.diffLayout === "unified" ? "unified" : "split",
    wrapCode: typeof raw.wrapCode === "boolean" ? raw.wrapCode : true,
    sidebarCollapsed:
      typeof raw.sidebarCollapsed === "boolean" ? raw.sidebarCollapsed : false,
    shortcuts: normalizeShortcuts(raw.shortcuts),
  };
}
let snapshot = defaultPreferences;
let initialized = false;
const listeners = new Set<() => void>();
function read() {
  try {
    return normalizePreferences(
      JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null"),
    );
  } catch {
    return { ...defaultPreferences };
  }
}
function apply(next: Preferences) {
  snapshot = next;
  const root = document.documentElement;
  root.style.setProperty("--ui-font-size", `${next.uiFontSize}px`);
  root.style.setProperty("--code-font-size", `${next.codeFontSize}px`);
  root.dataset.wrapCode = String(next.wrapCode);
  listeners.forEach((listener) => listener());
}
export function initializePreferences() {
  if (initialized) return;
  initialized = true;
  apply(read());
  window.addEventListener("storage", (event) => {
    if (event.key === PREFERENCES_KEY || event.key === null) apply(read());
  });
}
export function updatePreferences(patch: Partial<Preferences>) {
  const next = normalizePreferences({ ...snapshot, ...patch });
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    /* Session settings still apply. */
  }
  apply(next);
}
export const getPreferences = () => snapshot;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const usePreferences = () =>
  useSyncExternalStore(subscribe, getPreferences);
