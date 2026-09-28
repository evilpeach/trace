import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import type {
  AgentLaunch,
  ReviewAgent,
  ReviewAgentId,
  ReviewAgentOptions,
} from "../native-types";
import {
  chooseAgentModel,
  reconcileStoredAgentChoice,
  selectReviewAgent,
  updateAgentChoice,
  useAgentSettings,
  validAgentOptions,
} from "../agent-settings";

export interface AgentLaunchPanelProps {
  agents: ReviewAgent[];
  loading?: boolean;
  disabled?: boolean;
  busy?: boolean;
  native?: boolean;
  launch?: AgentLaunch;
  onRun?: (agent: ReviewAgentId, options: ReviewAgentOptions) => void;
}
export function AgentLaunchPanel({
  agents,
  loading = false,
  disabled = false,
  busy = false,
  native = true,
  launch,
  onRun,
}: AgentLaunchPanelProps) {
  const settings = useAgentSettings();
  const [resetNotice, setResetNotice] = useState<ReviewAgentId | null>(null);
  const agent = agents.find((item) => item.id === settings.selectedAgent);
  const requested = settings.choices[settings.selectedAgent];
  const options = validAgentOptions(agent, requested);
  const model = agent?.models.find((item) => item.id === options.model);
  const name =
    agent?.name ?? (settings.selectedAgent === "codex" ? "Codex" : "Claude");
  const invalidSavedChoice =
    !loading &&
    !!agent &&
    (requested.model !== options.model || requested.effort !== options.effort);
  const unavailable = !native
    ? "Agent execution is available in the Trace desktop app."
    : loading
      ? "Checking the installed agent and its model catalog…"
      : !agent?.available
        ? (agent?.reason ?? `${name} CLI is not available.`)
        : null;
  useEffect(() => {
    if (!loading && agent) {
      if (invalidSavedChoice) setResetNotice(agent.id);
      reconcileStoredAgentChoice(agent);
    }
  }, [agent, loading, invalidSavedChoice]);
  function run() {
    if (!native || disabled || busy || loading || !agent?.available || !onRun)
      return;
    const checked = validAgentOptions(agent, settings.choices[agent.id]);
    updateAgentChoice(agent, checked);
    onRun(agent.id, checked);
  }
  return (
    <section className="agent-launch-panel" aria-label="Agent settings">
      <div className="agent-choice-row">
        <span>Agent</span>
        <div role="group" aria-label="Coding agent">
          {(["codex", "claude"] as const).map((id) => (
            <button
              key={id}
              className={id === settings.selectedAgent ? "selected" : ""}
              aria-pressed={id === settings.selectedAgent}
              disabled={busy}
              onClick={() => {
                setResetNotice(null);
                selectReviewAgent(id);
              }}
            >
              {id === "codex" ? "Codex" : "Claude"}
            </button>
          ))}
        </div>
      </div>
      <div className="agent-model-fields">
        <label>
          Model
          <select
            aria-label="Model"
            value={options.model ?? ""}
            disabled={busy || loading || !agent?.models.length}
            onChange={(event) => {
              setResetNotice(null);
              if (agent)
                updateAgentChoice(
                  agent,
                  chooseAgentModel(agent, options, event.target.value || null),
                );
            }}
          >
            <option value="">CLI default</option>
            {agent?.models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Effort
          <select
            aria-label="Effort"
            value={options.effort ?? ""}
            disabled={busy || loading || !model?.efforts.length}
            onChange={(event) => {
              setResetNotice(null);
              if (agent)
                updateAgentChoice(agent, {
                  ...options,
                  effort: event.target.value || null,
                });
            }}
          >
            <option value="">CLI default</option>
            {model?.efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort.charAt(0).toUpperCase() + effort.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="agent-choice-help">
        {options.model
          ? model?.efforts.length
            ? "CLI default keeps your configured effort. Explicit choices apply to this launch."
            : "This model does not expose an adjustable effort setting."
          : "CLI default keeps the model and effort from your agent’s configuration. Select a model to set its effort."}
      </p>
      {invalidSavedChoice || resetNotice === settings.selectedAgent ? (
        <p className="agent-choice-reset" role="status">
          A saved model or effort is absent from the current catalog. That
          selection has been reset to CLI default.
        </p>
      ) : null}
      {agent?.modelNote ? (
        <p className="agent-catalog-note">{agent.modelNote}</p>
      ) : null}
      {agent?.modelSource ? (
        <details className="agent-catalog-source">
          <summary>Model catalog source</summary>
          <p>{agent.modelSource}</p>
        </details>
      ) : null}
      {unavailable ? (
        <p className="agent-choice-unavailable" role="status">
          {unavailable}
        </p>
      ) : null}
      <div className="agent-panel-actions">
        <button
          className="button primary"
          disabled={
            disabled ||
            busy ||
            loading ||
            !native ||
            !agent?.available ||
            !onRun
          }
          onClick={run}
        >
          <Terminal size={16} />
          {launch?.agent === settings.selectedAgent
            ? `Open ${name} again`
            : `Run with ${name}`}
        </button>
      </div>
    </section>
  );
}
