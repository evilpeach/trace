import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReviewAgent } from "./native-types";
import {
  AGENT_SETTINGS_KEY,
  chooseAgentModel,
  normalizeAgentSettings,
  persistAgentSettings,
  readAgentSettings,
  reconcileAgentChoice,
  validAgentOptions,
  withAgentChoice,
} from "./agent-settings";
import { AgentLaunchPanel } from "./components/AgentLaunchPanel";

const codex: ReviewAgent = {
  id: "codex",
  name: "Codex",
  path: "/tmp/codex",
  available: true,
  reason: null,
  models: [
    {
      id: "test-model-a",
      name: "Test model A",
      efforts: ["low", "high"],
      defaultEffort: "high",
    },
    {
      id: "test-model-b",
      name: "Test model B",
      efforts: ["low", "medium"],
      defaultEffort: "medium",
    },
    {
      id: "test-model-fixed",
      name: "Test fixed model",
      efforts: [],
      defaultEffort: null,
    },
  ],
  modelSource: "Test fixture catalog",
  modelNote: null,
};
const claude: ReviewAgent = {
  ...codex,
  id: "claude",
  name: "Claude",
  path: "/tmp/claude",
  models: [
    {
      id: "test-other-model",
      name: "Test other model",
      efforts: ["medium", "high"],
      defaultEffort: "medium",
    },
  ],
};
const defaults = () => normalizeAgentSettings(null);

describe("agent option validation", () => {
  it("starts with CLI defaults without forcing the catalog's model or effort defaults", () => {
    expect(defaults().choices.codex).toEqual({ model: null, effort: null });
    expect(validAgentOptions(codex, {})).toEqual({ model: null, effort: null });
    expect(validAgentOptions(codex, { model: null, effort: "high" })).toEqual({
      model: null,
      effort: null,
    });
    expect(validAgentOptions(codex, { model: "test-model-a" })).toEqual({
      model: "test-model-a",
      effort: null,
    });
  });
  it("accepts only model IDs and effort values in the current agent catalog", () => {
    expect(
      validAgentOptions(codex, { model: "test-model-a", effort: "high" }),
    ).toEqual({ model: "test-model-a", effort: "high" });
    expect(
      validAgentOptions(codex, { model: "test-model-b", effort: "high" }),
    ).toEqual({ model: "test-model-b", effort: null });
    expect(
      validAgentOptions(codex, { model: "missing-model", effort: "high" }),
    ).toEqual({ model: null, effort: null });
    expect(
      validAgentOptions(undefined, { model: "test-model-a", effort: "high" }),
    ).toEqual({ model: null, effort: null });
    expect(
      validAgentOptions(claude, { model: "test-model-a", effort: "high" }),
    ).toEqual({ model: null, effort: null });
  });
  it("keeps a compatible effort when switching models and clears incompatible choices", () => {
    expect(
      chooseAgentModel(
        codex,
        { model: "test-model-a", effort: "low" },
        "test-model-b",
      ),
    ).toEqual({ model: "test-model-b", effort: "low" });
    expect(
      chooseAgentModel(
        codex,
        { model: "test-model-a", effort: "high" },
        "test-model-b",
      ),
    ).toEqual({ model: "test-model-b", effort: null });
    expect(
      chooseAgentModel(
        codex,
        { model: "test-model-a", effort: "high" },
        "test-model-fixed",
      ),
    ).toEqual({ model: "test-model-fixed", effort: null });
    expect(
      chooseAgentModel(codex, { model: "test-model-a", effort: "high" }, null),
    ).toEqual({ model: null, effort: null });
  });
  it("remembers independent choices for Codex and Claude", () => {
    let settings = withAgentChoice(defaults(), codex, {
      model: "test-model-a",
      effort: "high",
    });
    settings = withAgentChoice(settings, claude, {
      model: "test-other-model",
      effort: "medium",
    });
    expect(settings.selectedAgent).toBe("claude");
    expect(settings.choices.codex).toEqual({
      model: "test-model-a",
      effort: "high",
    });
    expect(settings.choices.claude).toEqual({
      model: "test-other-model",
      effort: "medium",
    });
  });
  it("clears stale persisted choices on catalog refresh without switching the selected agent", () => {
    let settings = withAgentChoice(defaults(), codex, {
      model: "test-model-a",
      effort: "high",
    });
    settings = withAgentChoice(settings, claude, {
      model: "test-other-model",
      effort: "medium",
    });
    const updated = reconcileAgentChoice(settings, { ...codex, models: [] });
    expect(updated.choices.codex).toEqual({ model: null, effort: null });
    expect(updated.choices.claude).toEqual(settings.choices.claude);
    expect(updated.selectedAgent).toBe("claude");
    expect(reconcileAgentChoice(settings, codex)).toBe(settings);
  });
});

describe("guarded agent settings persistence", () => {
  it("recovers from malformed, oversized, blocked or unsupported storage", () => {
    for (const value of ["{broken", " ".repeat(16_385), '{"version":2}'])
      expect(readAgentSettings({ getItem: () => value })).toEqual(defaults());
    expect(
      readAgentSettings({
        getItem: () => {
          throw new Error("Storage blocked");
        },
      }),
    ).toEqual(defaults());
  });
  it("bounds identifiers and discards unsafe or unrelated fields", () => {
    const settings = normalizeAgentSettings({
      version: 1,
      selectedAgent: "unknown",
      choices: {
        codex: { model: "x".repeat(257), effort: "high" },
        claude: { model: "model\ninvalid", effort: "high" },
      },
      secret: "ignored",
    });
    expect(settings).toEqual(defaults());
    expect(
      normalizeAgentSettings({
        version: 1,
        choices: { codex: { model: "test-model-a", effort: "x".repeat(65) } },
      }).choices.codex,
    ).toEqual({ model: "test-model-a", effort: null });
  });
  it("round-trips per-agent settings with a versioned key and tolerates write failures", () => {
    const settings = withAgentChoice(defaults(), codex, {
      model: "test-model-a",
      effort: "high",
    });
    let stored = "";
    const setItem = vi.fn((_key: string, value: string) => {
      stored = value;
    });
    expect(persistAgentSettings({ setItem }, settings)).toBe(true);
    expect(setItem.mock.calls[0][0]).toBe(AGENT_SETTINGS_KEY);
    expect(readAgentSettings({ getItem: () => stored })).toEqual(settings);
    expect(
      persistAgentSettings(
        {
          setItem: () => {
            throw new Error("Storage full");
          },
        },
        settings,
      ),
    ).toBe(false);
  });
});

it("offers model controls before a comparison is ready while keeping Run gated", () => {
  const html = renderToStaticMarkup(
    createElement(AgentLaunchPanel, {
      agents: [codex, claude],
      disabled: true,
      onRun: () => {},
    }),
  );
  expect(html).toContain('aria-label="Coding agent"');
  expect(html).toContain("Test model A");
  expect(html.match(/<select aria-label="Model"[^>]*>/)?.[0]).not.toContain(
    "disabled",
  );
  expect(html.match(/<button class="button primary"[^>]*>/)?.[0]).toContain(
    "disabled",
  );
  expect(html).toContain("Run with Codex");
  expect(html).toContain("CLI default");
});
it("never enables launch in browser preview even when a catalog is supplied", () => {
  const html = renderToStaticMarkup(
    createElement(AgentLaunchPanel, {
      agents: [codex],
      native: false,
      onRun: () => {},
    }),
  );
  expect(html.match(/<button class="button primary"[^>]*>/)?.[0]).toContain(
    "disabled",
  );
  expect(html).toContain(
    "Agent execution is available in the Trace desktop app.",
  );
});
