import { useState } from "react";

export function LocalPathForm({
  label,
  placeholder,
  action,
  busy,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  action: string;
  busy: boolean;
  onSubmit: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  return (
    <form
      className="local-path-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && path.startsWith("/")) onSubmit(path);
      }}
    >
      <label className="local-path-label">
        {label}
        <span className="search-field">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            required
          />
        </span>
      </label>
      <div className="dialog-actions">
        <button
          className="button primary"
          disabled={busy || !path.startsWith("/")}
          type="submit"
        >
          {busy ? "Checking…" : action}
        </button>
      </div>
    </form>
  );
}
