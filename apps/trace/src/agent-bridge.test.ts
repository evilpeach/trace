import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));

import { client } from "./bridge";

describe("native agent launch boundary", () => {
  beforeEach(() => invoke.mockReset());

  it.each([
    ["codex", "gpt-6-astra", "xhigh"],
    ["claude", "claude-opus-5", "high"],
  ] as const)("forwards %s model and effort to the native launcher", async (agent, model, effort) => {
    const launch = { id: "launch", agent, model, effort };
    invoke.mockResolvedValue(launch);
    expect(await client.launchReviewAgent(["request"], agent, { model, effort })).toBe(launch);
    expect(invoke).toHaveBeenCalledWith("launch_review_agent", {
      ids: ["request"], agent, options: { model, effort },
    });
  });

  it("leaves CLI defaults unset for older callers", async () => {
    await client.launchReviewAgent(["request"], "codex");
    expect(invoke).toHaveBeenCalledWith("launch_review_agent", {
      ids: ["request"], agent: "codex", options: null,
    });
  });
});
