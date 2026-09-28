import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultPreferences,
  getPreferences,
  normalizePreferences,
  PREFERENCES_KEY,
  updatePreferences,
} from "./preferences";
import { defaultShortcuts } from "./shortcuts";

afterEach(() => vi.unstubAllGlobals());

describe("stored preferences", () => {
  it("recovers from missing and malformed settings", () => {
    expect(normalizePreferences(null)).toEqual(defaultPreferences);
    expect(
      normalizePreferences({
        uiFontSize: "18",
        codeFontSize: NaN,
        autoDetect: "no",
        diffLayout: "other",
        sidebarCollapsed: "yes",
      }),
    ).toEqual(defaultPreferences);
  });
  it("keeps font sizes usable and preserves independent choices", () => {
    expect(
      normalizePreferences({
        uiFontSize: 5,
        codeFontSize: 90,
        autoDetect: false,
        diffLayout: "unified",
        wrapCode: false,
      }),
    ).toEqual({
      ...defaultPreferences,
      uiFontSize: 14,
      codeFontSize: 18,
      autoDetect: false,
      diffLayout: "unified",
      wrapCode: false,
    });
    expect(normalizePreferences({ uiFontSize: 16.7 }).uiFontSize).toBe(17);
  });

  it("adds shortcuts to existing version-one preferences without changing reading settings", () => {
    const restored = normalizePreferences({
      uiFontSize: 17,
      codeFontSize: 16,
      autoDetect: false,
      wrapCode: false,
    });
    expect(restored.shortcuts).toEqual(defaultShortcuts);
    expect(restored.uiFontSize).toBe(17);
    expect(restored.codeFontSize).toBe(16);
    expect(restored.autoDetect).toBe(false);
    expect(restored.wrapCode).toBe(false);
    expect(restored.sidebarCollapsed).toBe(false);
  });

  it("persists customized and disabled shortcuts with other preferences", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal("document", {
      documentElement: { style: { setProperty: vi.fn() }, dataset: {} },
    });
    const shortcuts = {
      ...defaultShortcuts,
      back: "Mod+Shift+b",
      search: null,
    };
    updatePreferences({ uiFontSize: 17, shortcuts, sidebarCollapsed: true });
    const reloaded = normalizePreferences(
      JSON.parse(storage.get(PREFERENCES_KEY)!),
    );
    expect(reloaded.shortcuts).toEqual(shortcuts);
    expect(reloaded.uiFontSize).toBe(17);
    expect(reloaded.sidebarCollapsed).toBe(true);
    expect(getPreferences()).toEqual(reloaded);
    updatePreferences(defaultPreferences);
  });

  it("restores sidebar visibility only from a boolean preference", () => {
    expect(
      normalizePreferences({ sidebarCollapsed: true }).sidebarCollapsed,
    ).toBe(true);
    expect(
      normalizePreferences({ sidebarCollapsed: false }).sidebarCollapsed,
    ).toBe(false);
    expect(normalizePreferences({ sidebarCollapsed: 1 }).sidebarCollapsed).toBe(
      false,
    );
    expect(normalizePreferences({}).sidebarCollapsed).toBe(false);
  });

  it("keeps shortcut changes usable in the session when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("document", {
      documentElement: { style: { setProperty: vi.fn() }, dataset: {} },
    });
    expect(() =>
      updatePreferences({
        shortcuts: { ...defaultShortcuts, focusDiff: null },
      }),
    ).not.toThrow();
    expect(getPreferences().shortcuts.focusDiff).toBeNull();
    updatePreferences(defaultPreferences);
  });
});
