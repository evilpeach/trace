import { RotateCcw } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import {
  defaultPreferences,
  updatePreferences,
  usePreferences,
} from "../preferences";
import { setThemePreference } from "../theme";
import { ThemePicker } from "./ThemePicker";
import {
  captureShortcut,
  defaultShortcuts,
  findShortcutConflict,
  formatShortcut,
  getShortcutPlatform,
  shortcutDefinitions,
  type ShortcutAction,
} from "../shortcuts";
import "../keyboard-shortcuts.css";

function KeyboardShortcuts() {
  const { shortcuts } = usePreferences();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<{
    action: ShortcutAction;
    message: string;
  } | null>(null);
  const hintId = useId();
  const modifier = getShortcutPlatform() === "mac" ? "Command" : "Control";

  function saveBinding(action: ShortcutAction, binding: string | null) {
    const conflict =
      binding && findShortcutConflict(shortcuts, binding, action);
    if (conflict) {
      const label = shortcutDefinitions.find(
        ({ id }) => id === conflict,
      )!.label;
      setError({
        action,
        message: `${formatShortcut(binding)} is already assigned to ${label}. Choose another shortcut or change that action first.`,
      });
      return;
    }
    updatePreferences({ shortcuts: { ...shortcuts, [action]: binding } });
    setRecording(null);
    setError(null);
  }

  function recordKey(
    event: KeyboardEvent<HTMLButtonElement>,
    action: ShortcutAction,
  ) {
    if (recording !== action) return;
    event.stopPropagation();
    if (event.key === "Tab") {
      setRecording(null);
      return;
    }
    // Prevent the dialog's native Escape cancel event as well as app shortcuts.
    event.preventDefault();
    if (event.key === "Escape") {
      setRecording(null);
      setError(null);
      return;
    }
    if (event.repeat) return;
    const result = captureShortcut(event);
    if (result.error) setError({ action, message: result.error });
    else if (result.binding) saveBinding(action, result.binding);
  }

  return (
    <section className="keyboard-shortcuts" aria-labelledby={`${hintId}-title`}>
      <div className="keyboard-shortcuts-heading">
        <h3 id={`${hintId}-title`}>Keyboard shortcuts</h3>
        <button
          className="button small"
          onClick={() => {
            updatePreferences({ shortcuts: defaultShortcuts });
            setRecording(null);
            setError(null);
          }}
        >
          <RotateCcw size={14} /> Reset shortcuts
        </button>
      </div>
      <p id={hintId} className="keyboard-shortcuts-hint">
        Select a shortcut, then press {modifier} with a key. Shift and
        Option/Alt are optional. Escape cancels; Tab moves on. Standard editing
        and system shortcuts are reserved.
      </p>
      <div className="keyboard-shortcut-list">
        {shortcutDefinitions.map(
          ({ id, label, description, defaultBinding }) => (
            <div className="keyboard-shortcut-row" key={id}>
              <div className="keyboard-shortcut-description">
                <strong>{label}</strong>
                <small>{description}</small>
              </div>
              <div className="keyboard-shortcut-controls">
                <button
                  className={`keyboard-shortcut-recorder${recording === id ? " is-recording" : ""}`}
                  data-shortcut-recorder="true"
                  aria-label={`Change ${label.toLowerCase()} shortcut: ${formatShortcut(shortcuts[id])}`}
                  aria-pressed={recording === id}
                  aria-describedby={
                    error?.action === id
                      ? `${hintId} ${hintId}-${id}-error`
                      : hintId
                  }
                  onClick={(event) => {
                    event.currentTarget.focus();
                    setRecording(recording === id ? null : id);
                    setError(null);
                  }}
                  onBlur={() =>
                    setRecording((active) => (active === id ? null : active))
                  }
                  onKeyDown={(event) => recordKey(event, id)}
                >
                  {recording === id ? (
                    <span>Press shortcut…</span>
                  ) : (
                    <kbd>{formatShortcut(shortcuts[id])}</kbd>
                  )}
                </button>
                <button
                  className="keyboard-shortcut-text-button"
                  disabled={shortcuts[id] === null}
                  aria-label={`Disable ${label.toLowerCase()} shortcut`}
                  onClick={() => saveBinding(id, null)}
                >
                  Disable
                </button>
                <button
                  className="keyboard-shortcut-text-button"
                  disabled={shortcuts[id] === defaultBinding}
                  aria-label={`Reset ${label.toLowerCase()} shortcut`}
                  title={`Reset to ${formatShortcut(defaultBinding)}`}
                  onClick={() => saveBinding(id, defaultBinding)}
                >
                  Reset
                </button>
              </div>
              {error?.action === id && (
                <p
                  className="keyboard-shortcut-error"
                  id={`${hintId}-${id}-error`}
                  role="alert"
                >
                  {error.message}
                </p>
              )}
            </div>
          ),
        )}
      </div>
      <p className="keyboard-shortcuts-hint">
        Back and forward follow your selections within one report. Opening
        another report starts a new history.
      </p>
    </section>
  );
}

export function SettingsPanel({ native }: { native: boolean }) {
  const prefs = usePreferences();
  const [shortcutsResetVersion, setShortcutsResetVersion] = useState(0);
  return (
    <div className="settings-panel">
      <section>
        <h3>Appearance & reading</h3>
        <ThemePicker />
        <label className="setting-row">
          <span>
            <strong>Interface text</strong>
            <small>Navigation, summaries, and report details</small>
          </span>
          <span className="setting-range">
            <input
              aria-label="Interface font size"
              type="range"
              min="14"
              max="18"
              step="1"
              value={prefs.uiFontSize}
              onChange={(e) =>
                updatePreferences({ uiFontSize: Number(e.target.value) })
              }
            />
            <span className="setting-value">{prefs.uiFontSize} px</span>
          </span>
        </label>
        <label className="setting-row">
          <span>
            <strong>Code text</strong>
            <small>Adjust diffs separately from the interface</small>
          </span>
          <span className="setting-range">
            <input
              aria-label="Code font size"
              type="range"
              min="12"
              max="18"
              step="1"
              value={prefs.codeFontSize}
              onChange={(e) =>
                updatePreferences({ codeFontSize: Number(e.target.value) })
              }
            />
            <span className="setting-value">{prefs.codeFontSize} px</span>
          </span>
        </label>
        <div className="settings-preview">
          <strong>A change you can follow.</strong>
          <p>Readable summaries, with the source one click away.</p>
          <code>const review = trace.follow(change);</code>
        </div>
      </section>
      <section>
        <h3>Code review</h3>
        <label className="setting-row">
          <span>
            <strong>Default diff view</strong>
            <small>Applies to the current review and future reports</small>
          </span>
          <select
            aria-label="Default diff view"
            value={prefs.diffLayout}
            onChange={(e) =>
              updatePreferences({
                diffLayout: e.target.value as "split" | "unified",
              })
            }
          >
            <option value="split">Side by side</option>
            <option value="unified">Unified</option>
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>Wrap long code lines</strong>
            <small>Keep full lines readable inside each diff column</small>
          </span>
          <input
            type="checkbox"
            checked={prefs.wrapCode}
            onChange={(e) => updatePreferences({ wrapCode: e.target.checked })}
          />
        </label>
      </section>
      <section>
        <h3>Report detection</h3>
        <label className="setting-row">
          <span>
            <strong>Detect reports automatically</strong>
            <small>
              {native
                ? "Check prepared requests and connected project .trace folders on launch, on return, and every 30 seconds while Trace is visible."
                : "Available in the Mac app. Browser reports are imported manually."}
            </small>
          </span>
          <input
            type="checkbox"
            disabled={!native}
            checked={prefs.autoDetect}
            onChange={(e) =>
              updatePreferences({ autoDetect: e.target.checked })
            }
          />
        </label>
        <p className="caption">
          New review prepares an exact output location and the report toolkit
          for your external coding agent. Use Check now in Review activity when
          automatic detection is off. Existing <code>.trace/*.trace.json</code>{" "}
          reports are also detected. New reports never interrupt your current
          review.
        </p>
      </section>
      <KeyboardShortcuts key={shortcutsResetVersion} />
      <div className="settings-footer">
        <span className="muted">Settings are saved on this device.</span>
        <button
          className="button"
          onClick={() => {
            updatePreferences(defaultPreferences);
            setThemePreference("system");
            setShortcutsResetVersion((version) => version + 1);
          }}
        >
          <RotateCcw size={14} />
          Reset defaults
        </button>
      </div>
    </div>
  );
}
