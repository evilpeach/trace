export type ShortcutAction =
  | "back"
  | "forward"
  | "toggleSidebar"
  | "search"
  | "settings"
  | "newReview"
  | "overview"
  | "files"
  | "flows"
  | "findings"
  | "focusDiff";

export type ShortcutBindings = Record<ShortcutAction, string | null>;
export type ShortcutPlatform = "mac" | "other";

export function getShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined" || !navigator.platform) return "mac";
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "mac" : "other";
}

interface ShortcutDefinition {
  id: ShortcutAction;
  label: string;
  description: string;
  defaultBinding: string;
}

export const shortcutDefinitions: readonly ShortcutDefinition[] = [
  {
    id: "back",
    label: "Go back",
    description: "Previous selection in the current report",
    defaultBinding: "Mod+[",
  },
  {
    id: "forward",
    label: "Go forward",
    description: "Next selection in the current report",
    defaultBinding: "Mod+]",
  },
  {
    id: "toggleSidebar",
    label: "Toggle sidebar",
    description: "Collapse or expand the workspace sidebar",
    defaultBinding: "Mod+b",
  },
  {
    id: "search",
    label: "Search review",
    description: "Find files, flows, and findings",
    defaultBinding: "Mod+k",
  },
  {
    id: "settings",
    label: "Open settings",
    description: "Appearance, reading, and shortcuts",
    defaultBinding: "Mod+,",
  },
  {
    id: "newReview",
    label: "New review",
    description: "Prepare a review request",
    defaultBinding: "Mod+n",
  },
  {
    id: "overview",
    label: "Show overview",
    description: "Summary and main journey",
    defaultBinding: "Mod+1",
  },
  {
    id: "files",
    label: "Show files",
    description: "File explanations and diffs",
    defaultBinding: "Mod+2",
  },
  {
    id: "flows",
    label: "Show flows",
    description: "Follow the behavior of the change",
    defaultBinding: "Mod+3",
  },
  {
    id: "findings",
    label: "Show findings",
    description: "Issues to investigate",
    defaultBinding: "Mod+4",
  },
  {
    id: "focusDiff",
    label: "Focus diff",
    description: "Expand or restore the current file diff",
    defaultBinding: "Mod+Shift+f",
  },
];

export const defaultShortcuts: ShortcutBindings = Object.fromEntries(
  shortcutDefinitions.map(({ id, defaultBinding }) => [id, defaultBinding]),
) as ShortcutBindings;

export interface ShortcutKeyboardEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

const punctuationCodes: Readonly<Record<string, string>> = {
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};
const namedKeys: Readonly<Record<string, string>> = {
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};
const modifierKeys = new Set(["Meta", "Control", "Alt", "Shift"]);
const reservedKeys = new Set([
  "q",
  "w",
  "h",
  "m",
  "c",
  "v",
  "x",
  "a",
  "z",
  "`",
]);

function normalizeKey(key: string): string | null {
  const lower = key.toLowerCase();
  if (/^[a-z0-9\[\]\\,./;'\-=`]$/.test(lower)) return lower;
  if (/^f([1-9]|1[0-2])$/.test(lower)) return lower.toUpperCase();
  return namedKeys[lower] ?? null;
}

function isReserved(key: string, shift: boolean): boolean {
  return reservedKeys.has(key) || (shift && ["3", "4", "5"].includes(key));
}

function normalizeBinding(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parts = value
    .trim()
    .split("+")
    .map((part) => part.trim());
  const key = normalizeKey(parts.pop() ?? "");
  const modifiers = parts.map((part) => part.toLowerCase());
  if (
    !key ||
    !modifiers.includes("mod") ||
    modifiers.some((part) => !["mod", "shift", "alt"].includes(part)) ||
    new Set(modifiers).size !== modifiers.length ||
    isReserved(key, modifiers.includes("shift"))
  )
    return null;
  return [
    "Mod",
    ...(modifiers.includes("alt") ? ["Alt"] : []),
    ...(modifiers.includes("shift") ? ["Shift"] : []),
    key,
  ].join("+");
}

/** Missing entries keep defaults; null explicitly disables an action. */
export function normalizeShortcuts(value: unknown): ShortcutBindings {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result = { ...defaultShortcuts };
  for (const { id, defaultBinding } of shortcutDefinitions) {
    result[id] =
      raw[id] === null ? null : (normalizeBinding(raw[id]) ?? defaultBinding);
  }
  // This action was added after shortcut customization shipped. Keep a legacy
  // user's existing Command+B assignment instead of taking it for the sidebar.
  if (
    raw.toggleSidebar === undefined &&
    shortcutDefinitions.some(
      ({ id }) =>
        id !== "toggleSidebar" && result[id] === defaultShortcuts.toggleSidebar,
    )
  ) {
    result.toggleSidebar = null;
  }
  // Corrupt saved collisions restore the affected actions' defaults. Iterate
  // because restoring a default can reveal a collision with another custom key.
  for (let pass = 0; pass < shortcutDefinitions.length; pass++) {
    const groups = new Map<string, ShortcutAction[]>();
    for (const { id } of shortcutDefinitions) {
      const binding = result[id];
      if (binding) groups.set(binding, [...(groups.get(binding) ?? []), id]);
    }
    const conflicts = [...groups.values()]
      .filter((actions) => actions.length > 1)
      .flat();
    if (!conflicts.length) break;
    for (const id of conflicts) result[id] = defaultShortcuts[id];
  }
  return result;
}

export function findShortcutConflict(
  bindings: ShortcutBindings,
  binding: string,
  exceptAction?: ShortcutAction,
): ShortcutAction | null {
  const normalized = normalizeBinding(binding);
  if (!normalized) return null;
  return (
    shortcutDefinitions.find(
      ({ id }) =>
        id !== exceptAction && normalizeBinding(bindings[id]) === normalized,
    )?.id ?? null
  );
}

/** Modifier-only key presses keep the recorder waiting without an error. */
export function captureShortcut(
  event: ShortcutKeyboardEvent,
  platform = getShortcutPlatform(),
): {
  binding: string | null;
  error: string | null;
} {
  if (modifierKeys.has(event.key)) return { binding: null, error: null };
  if (event.isComposing)
    return {
      binding: null,
      error: "Finish text composition before recording a shortcut.",
    };
  if (event.metaKey && event.ctrlKey)
    return {
      binding: null,
      error: "Use Command or Control, not both together.",
    };
  if (platform === "mac" ? !event.metaKey : !event.ctrlKey)
    return {
      binding: null,
      error:
        platform === "mac"
          ? "Hold Command with another key. Control is reserved for text editing."
          : "Hold Control with another key.",
    };
  // Physical punctuation and number keys stay stable when Shift changes the
  // event.key value to a brace, symbol, or a keyboard-layout dead key.
  const key = normalizeKey(
    punctuationCodes[event.code ?? ""] ??
      (/^Digit[0-9]$/.test(event.code ?? "")
        ? event.code!.slice(5)
        : event.altKey && /^Key[A-Z]$/.test(event.code ?? "")
          ? event.code!.slice(3)
          : event.key),
  );
  if (!key)
    return {
      binding: null,
      error:
        "Choose a letter, number, punctuation key, arrow, or function key.",
    };
  if (isReserved(key, event.shiftKey))
    return {
      binding: null,
      error:
        "That combination is reserved for macOS or standard editing commands.",
    };
  return {
    binding: [
      "Mod",
      ...(event.altKey ? ["Alt"] : []),
      ...(event.shiftKey ? ["Shift"] : []),
      key,
    ].join("+"),
    error: null,
  };
}

export function matchShortcut(
  event: ShortcutKeyboardEvent,
  bindings: ShortcutBindings,
  platform = getShortcutPlatform(),
): ShortcutAction | null {
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;
  const { binding } = captureShortcut(event, platform);
  return binding
    ? (shortcutDefinitions.find(({ id }) => bindings[id] === binding)?.id ??
        null)
    : null;
}

export function formatShortcut(
  binding: string | null,
  platform = getShortcutPlatform(),
): string {
  if (binding === null) return "Disabled";
  const normalized = normalizeBinding(binding);
  if (!normalized) return "Not set";
  const parts = normalized.split("+");
  const key = parts.pop()!;
  const labels: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Home: "Home",
    End: "End",
    PageUp: "Page Up",
    PageDown: "Page Down",
  };
  const label = labels[key] ?? key.toUpperCase();
  return platform === "mac"
    ? `${parts.includes("Alt") ? "⌥" : ""}${parts.includes("Shift") ? "⇧" : ""}⌘${label}`
    : [
        "Ctrl",
        ...(parts.includes("Alt") ? ["Alt"] : []),
        ...(parts.includes("Shift") ? ["Shift"] : []),
        label,
      ].join("+");
}
