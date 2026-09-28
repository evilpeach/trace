import { useId, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  getThemeSnapshot,
  setThemePreference,
  subscribeToTheme,
} from "../theme";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const { preference } = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
  );
  return (
    <div className={`theme-picker ${compact ? "theme-picker-compact" : ""}`}>
      <span className="theme-picker-label" id={id}>
        Appearance
      </span>
      <div className="theme-picker-options" role="group" aria-labelledby={id}>
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={preference === value}
            title={
              value === "system"
                ? "Follow system appearance"
                : `Use ${label.toLowerCase()} appearance`
            }
            onClick={() => setThemePreference(value)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
