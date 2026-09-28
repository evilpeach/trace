import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  setTheme: vi.fn().mockResolvedValue(undefined),
  enabled: false,
}));
vi.mock("@tauri-apps/api/app", () => ({ setTheme: native.setTheme }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));

let saved: string | null;
let blocked: boolean;
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn> };
let onSystemChange: () => void;
let root: { dataset: Record<string, string>; style: Record<string, string> };

beforeEach(() => {
  vi.resetModules();
  native.setTheme.mockClear();
  native.enabled = false;
  saved = null;
  blocked = false;
  root = { dataset: {}, style: {} };
  media = {
    matches: true,
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      onSystemChange = listener;
    }),
  };
  vi.stubGlobal("window", {
    matchMedia: () => media,
    addEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("localStorage", {
    getItem: () => {
      if (blocked) throw new Error("Storage blocked");
      return saved;
    },
    setItem: (_key: string, value: string) => {
      if (blocked) throw new Error("Storage blocked");
      saved = value;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it("defaults to system before rendering and reacts to live system changes", async () => {
  const theme = await import("./theme");
  theme.initializeTheme();
  expect(root.dataset).toEqual({ theme: "dark", themePreference: "system" });
  const changed = vi.fn();
  const unsubscribe = theme.subscribeToTheme(changed);
  media.matches = false;
  onSystemChange();
  expect(root.style.colorScheme).toBe("light");
  expect(theme.getThemeSnapshot()).toEqual({
    preference: "system",
    resolved: "light",
  });
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
  media.matches = true;
  onSystemChange();
  expect(changed).toHaveBeenCalledTimes(1);
  theme.initializeTheme();
  expect(media.addEventListener).toHaveBeenCalledTimes(1);
});

it("persists explicit overrides across reloads and resumes system following", async () => {
  let theme = await import("./theme");
  theme.initializeTheme();
  theme.setThemePreference("light");
  expect(saved).toBe("light");
  onSystemChange();
  expect(root.dataset.theme).toBe("light");
  vi.resetModules();
  theme = await import("./theme");
  theme.initializeTheme();
  expect(root.dataset.themePreference).toBe("light");
  theme.setThemePreference("system");
  expect(saved).toBe("system");
  expect(root.dataset.theme).toBe("dark");
});

it("uses system for invalid saved values and works when storage is unavailable", async () => {
  saved = "invalid";
  let theme = await import("./theme");
  theme.initializeTheme();
  expect(theme.getThemeSnapshot().preference).toBe("system");
  blocked = true;
  vi.resetModules();
  theme = await import("./theme");
  expect(() => theme.initializeTheme()).not.toThrow();
  expect(() => theme.setThemePreference("light")).not.toThrow();
  expect(root.dataset.theme).toBe("light");
});

it("serializes native overrides and clears the override for System", async () => {
  native.enabled = true;
  const theme = await import("./theme");
  theme.initializeTheme();
  theme.setThemePreference("dark");
  theme.setThemePreference("light");
  theme.setThemePreference("system");
  await vi.waitFor(() => expect(native.setTheme).toHaveBeenCalledTimes(4));
  expect(native.setTheme.mock.calls).toEqual([
    [null],
    ["dark"],
    ["light"],
    [null],
  ]);
});
