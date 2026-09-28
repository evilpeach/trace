import { describe, expect, it } from "vitest";
import {
  captureShortcut,
  defaultShortcuts,
  findShortcutConflict,
  formatShortcut,
  matchShortcut,
  normalizeShortcuts,
  shortcutDefinitions,
  type ShortcutKeyboardEvent,
} from "./shortcuts";

function key(
  key: string,
  overrides: Partial<ShortcutKeyboardEvent> = {},
): ShortcutKeyboardEvent {
  return {
    key,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("keyboard shortcut matching", () => {
  it("matches the complete default action set", () => {
    for (const definition of shortcutDefinitions) {
      const parts = definition.defaultBinding.split("+");
      expect(
        matchShortcut(
          key(parts.at(-1)!, { shiftKey: parts.includes("Shift") }),
          defaultShortcuts,
          "mac",
        ),
      ).toBe(definition.id);
    }
    expect(shortcutDefinitions).toHaveLength(11);
  });

  it("requires the platform's primary modifier and leaves Mac Control editing intact", () => {
    expect(
      matchShortcut(
        key("k", { metaKey: false, ctrlKey: true }),
        defaultShortcuts,
        "mac",
      ),
    ).toBeNull();
    expect(
      matchShortcut(
        key("k", { metaKey: false, ctrlKey: true }),
        defaultShortcuts,
        "other",
      ),
    ).toBe("search");
    expect(matchShortcut(key("k"), defaultShortcuts, "other")).toBeNull();
    expect(
      matchShortcut(key("k", { ctrlKey: true }), defaultShortcuts, "mac"),
    ).toBeNull();
  });

  it("matches exact modifiers, custom assignments, and explicit disabled actions", () => {
    const bindings = normalizeShortcuts({ back: "Mod+Shift+b", search: null });
    expect(matchShortcut(key("B", { shiftKey: true }), bindings, "mac")).toBe(
      "back",
    );
    expect(matchShortcut(key("b"), bindings, "mac")).toBe("toggleSidebar");
    expect(matchShortcut(key("["), bindings, "mac")).toBeNull();
    expect(matchShortcut(key("k"), bindings, "mac")).toBeNull();
    expect(
      matchShortcut(
        key("B", { shiftKey: true, altKey: true }),
        bindings,
        "mac",
      ),
    ).toBeNull();
  });

  it("ignores consumed, repeating, and composing events", () => {
    for (const overrides of [
      { defaultPrevented: true },
      { repeat: true },
      { isComposing: true },
    ]) {
      expect(
        matchShortcut(key("k", overrides), defaultShortcuts, "mac"),
      ).toBeNull();
    }
  });
});

describe("recording keyboard shortcuts", () => {
  it("normalizes shifted punctuation and digits from their physical key", () => {
    expect(
      captureShortcut(key("{", { code: "BracketLeft", shiftKey: true }), "mac")
        .binding,
    ).toBe("Mod+Shift+[");
    expect(
      captureShortcut(key("!", { code: "Digit1", shiftKey: true }), "mac")
        .binding,
    ).toBe("Mod+Shift+1");
    expect(
      captureShortcut(key("+", { code: "Equal", shiftKey: true }), "mac")
        .binding,
    ).toBe("Mod+Shift+=");
    const bindings = normalizeShortcuts({ back: "Mod+Shift+[" });
    expect(
      matchShortcut(
        key("{", { code: "BracketLeft", shiftKey: true }),
        bindings,
        "mac",
      ),
    ).toBe("back");
  });

  it("supports Option letter combinations even when macOS produces a symbol", () => {
    const event = key("ƒ", { code: "KeyF", altKey: true });
    expect(captureShortcut(event, "mac").binding).toBe("Mod+Alt+f");
    expect(
      matchShortcut(
        event,
        normalizeShortcuts({ focusDiff: "Mod+Alt+f" }),
        "mac",
      ),
    ).toBe("focusDiff");
  });

  it("waits on modifier keys and rejects bare characters and unsupported keys", () => {
    expect(captureShortcut(key("Shift", { shiftKey: true }), "mac")).toEqual({
      binding: null,
      error: null,
    });
    expect(
      captureShortcut(key("f", { metaKey: false }), "mac").error,
    ).toContain("Hold Command");
    for (const unsupported of ["Escape", "Tab", " ", "Enter", "Dead"]) {
      expect(captureShortcut(key(unsupported), "mac").binding).toBeNull();
    }
  });

  it("rejects native editing, window, app, screenshot, and fullscreen bindings", () => {
    for (const letter of ["a", "c", "v", "x", "z", "m", "h", "w", "q", "`"]) {
      expect(captureShortcut(key(letter), "mac").error).toContain("reserved");
    }
    expect(
      captureShortcut(key("Z", { shiftKey: true }), "mac").binding,
    ).toBeNull();
    expect(
      captureShortcut(key("h", { altKey: true }), "mac").binding,
    ).toBeNull();
    expect(
      captureShortcut(key("f", { ctrlKey: true }), "mac").binding,
    ).toBeNull();
    expect(
      captureShortcut(key("#", { code: "Digit3", shiftKey: true }), "mac")
        .binding,
    ).toBeNull();
  });

  it("identifies conflicts for both capture and individual default reset", () => {
    const bindings = normalizeShortcuts({ back: "Mod+b", search: "Mod+[" });
    expect(findShortcutConflict(bindings, "Mod+[", "back")).toBe("search");
    expect(findShortcutConflict(bindings, "Mod+b", "back")).toBeNull();
    expect(findShortcutConflict(bindings, "mod+shift+F", "back")).toBe(
      "focusDiff",
    );
    expect(findShortcutConflict(bindings, "Mod+p", "back")).toBeNull();
  });
});

describe("stored shortcut normalization", () => {
  it("recovers old preferences, malformed maps, invalid keys, and reserved keys", () => {
    for (const value of [
      undefined,
      null,
      [],
      "garbage",
      { back: 4, search: "k", focusDiff: "Mod+q", files: "Mod+Mod+2" },
    ]) {
      expect(normalizeShortcuts(value)).toEqual(defaultShortcuts);
    }
  });

  it("preserves disabled keys and canonicalizes valid assignments without unknown properties", () => {
    const result = normalizeShortcuts({
      back: " shift + MOD + B ",
      forward: null,
      extra: "Mod+p",
    });
    expect(result).toEqual({
      ...defaultShortcuts,
      back: "Mod+Shift+b",
      forward: null,
    });
    expect(normalizeShortcuts(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });

  it("restores colliding saved actions to defaults including cascading collisions", () => {
    expect(
      normalizeShortcuts({ back: "Mod+k", search: "Mod+2", forward: "Mod+b" }),
    ).toEqual({ ...defaultShortcuts, forward: "Mod+b", toggleSidebar: null });
    expect(normalizeShortcuts({ back: "Mod+k", search: "Mod+[" })).toEqual({
      ...defaultShortcuts,
      back: "Mod+k",
      search: "Mod+[",
    });
  });

  it("preserves a legacy Command+B assignment when adding the sidebar shortcut", () => {
    const legacy: Record<string, string | null> = {
      ...defaultShortcuts,
      back: "Mod+b",
    };
    delete legacy.toggleSidebar;
    const migrated = normalizeShortcuts(legacy);
    expect(migrated).toEqual({
      ...defaultShortcuts,
      back: "Mod+b",
      toggleSidebar: null,
    });
    expect(matchShortcut(key("b"), migrated, "mac")).toBe("back");
    expect(findShortcutConflict(migrated, "Mod+b", "toggleSidebar")).toBe(
      "back",
    );
    expect(normalizeShortcuts(JSON.parse(JSON.stringify(migrated)))).toEqual(
      migrated,
    );
  });

  it("enables the new sidebar shortcut when a legacy map leaves Command+B available", () => {
    const legacy: Record<string, string | null> = { ...defaultShortcuts };
    delete legacy.toggleSidebar;
    expect(normalizeShortcuts(legacy).toggleSidebar).toBe("Mod+b");
    expect(
      normalizeShortcuts({ toggleSidebar: null }).toggleSidebar,
    ).toBeNull();
  });

  it("formats shortcuts consistently for platform labels and disabled controls", () => {
    expect(formatShortcut("Mod+Shift+f", "mac")).toBe("⇧⌘F");
    expect(formatShortcut("Mod+Alt+ArrowLeft", "mac")).toBe("⌥⌘←");
    expect(formatShortcut("Mod+,", "other")).toBe("Ctrl+,");
    expect(formatShortcut(null)).toBe("Disabled");
    expect(formatShortcut("invalid")).toBe("Not set");
  });
});
