import { useSyncExternalStore } from "react";
import type {
  ReviewAgent,
  ReviewAgentId,
  ReviewAgentOptions,
} from "./native-types";

export interface AgentChoice {
  model: string | null;
  effort: string | null;
}
export interface AgentSettings {
  version: 1;
  selectedAgent: ReviewAgentId;
  choices: Record<ReviewAgentId, AgentChoice>;
}
export const AGENT_SETTINGS_KEY = "trace:agent-settings:v1";
const defaults = (): AgentSettings => ({
  version: 1,
  selectedAgent: "codex",
  choices: {
    codex: { model: null, effort: null },
    claude: { model: null, effort: null },
  },
});
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const identifier = (value: unknown, limit: number): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= limit &&
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
export function normalizeAgentSettings(value: unknown): AgentSettings {
  const raw = object(value);
  if (raw.version !== 1) return defaults();
  const choices = object(raw.choices);
  const choice = (id: ReviewAgentId): AgentChoice => {
    const item = object(choices[id]),
      model = identifier(item.model, 256);
    return { model, effort: model ? identifier(item.effort, 64) : null };
  };
  return {
    version: 1,
    selectedAgent: raw.selectedAgent === "claude" ? "claude" : "codex",
    choices: { codex: choice("codex"), claude: choice("claude") },
  };
}
export function readAgentSettings(
  storage: Pick<Storage, "getItem">,
): AgentSettings {
  try {
    const raw = storage.getItem(AGENT_SETTINGS_KEY);
    return raw && raw.length <= 16_384
      ? normalizeAgentSettings(JSON.parse(raw))
      : defaults();
  } catch {
    return defaults();
  }
}
/** Only catalog-listed model/effort combinations can reach a launch. */
export function validAgentOptions(
  agent: ReviewAgent | undefined,
  options: ReviewAgentOptions | undefined,
): AgentChoice {
  const model = agent?.models.find((item) => item.id === options?.model);
  if (!model) return { model: null, effort: null };
  return {
    model: model.id,
    effort:
      typeof options?.effort === "string" &&
      model.efforts.includes(options.effort)
        ? options.effort
        : null,
  };
}
export function chooseAgentModel(
  agent: ReviewAgent,
  previous: ReviewAgentOptions,
  model: string | null,
): AgentChoice {
  return validAgentOptions(agent, { model, effort: previous.effort });
}
export function withAgentChoice(
  settings: AgentSettings,
  agent: ReviewAgent,
  options: ReviewAgentOptions,
): AgentSettings {
  return {
    ...settings,
    selectedAgent: agent.id,
    choices: {
      ...settings.choices,
      [agent.id]: validAgentOptions(agent, options),
    },
  };
}
export function reconcileAgentChoice(
  settings: AgentSettings,
  agent: ReviewAgent,
): AgentSettings {
  const before = settings.choices[agent.id],
    after = validAgentOptions(agent, before);
  return before.model === after.model && before.effort === after.effort
    ? settings
    : { ...settings, choices: { ...settings.choices, [agent.id]: after } };
}
export function persistAgentSettings(
  storage: Pick<Storage, "setItem">,
  settings: AgentSettings,
): boolean {
  try {
    storage.setItem(
      AGENT_SETTINGS_KEY,
      JSON.stringify(normalizeAgentSettings(settings)),
    );
    return true;
  } catch {
    return false;
  }
}

let snapshot = defaults();
let initialized = false;
const serverSnapshot = defaults();
const listeners = new Set<() => void>();
function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    snapshot = readAgentSettings(window.localStorage);
  } catch {
    /* Session choices still work. */
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== AGENT_SETTINGS_KEY && event.key !== null) return;
    try {
      snapshot = readAgentSettings(window.localStorage);
    } catch {
      snapshot = defaults();
    }
    listeners.forEach((listener) => listener());
  });
}
export function getAgentSettings() {
  initialize();
  return snapshot;
}
function save(next: AgentSettings) {
  snapshot = normalizeAgentSettings(next);
  try {
    persistAgentSettings(window.localStorage, snapshot);
  } catch {
    /* Private storage can be unavailable. */
  }
  listeners.forEach((listener) => listener());
}
export function selectReviewAgent(agent: ReviewAgentId) {
  save({ ...getAgentSettings(), selectedAgent: agent });
}
export function updateAgentChoice(
  agent: ReviewAgent,
  options: ReviewAgentOptions,
) {
  save(withAgentChoice(getAgentSettings(), agent, options));
}
export function reconcileStoredAgentChoice(agent: ReviewAgent) {
  const current = getAgentSettings(),
    next = reconcileAgentChoice(current, agent);
  if (next !== current) save(next);
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useAgentSettings = () =>
  useSyncExternalStore(subscribe, getAgentSettings, () => serverSnapshot);
