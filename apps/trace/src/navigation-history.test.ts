import { describe, expect, it } from "vitest";
import {
  createNavigationHistory,
  navigationReducer,
} from "./navigation-history";
import type { ReviewPosition } from "./review-workspace";

const start: ReviewPosition = {
  view: "overview",
  fileId: "",
  flowId: "",
  findingId: "",
  evidenceId: null,
};

describe("review navigation history", () => {
  it("retraces file, flow, and source selections in both directions", () => {
    let history = createNavigationHistory(start);
    history = navigationReducer(history, {
      type: "navigate",
      next: { view: "flows", flowId: "journey" },
    });
    const flow = history.current;
    history = navigationReducer(history, {
      type: "navigate",
      next: { view: "files", fileId: "source", evidenceId: "anchor" },
    });
    const source = history.current;
    history = navigationReducer(history, { type: "back" });
    expect(history.current).toEqual(flow);
    history = navigationReducer(history, { type: "back" });
    expect(history.current).toEqual(start);
    history = navigationReducer(history, { type: "forward" });
    history = navigationReducer(history, { type: "forward" });
    expect(history.current).toEqual(source);
    expect(history.forward).toEqual([]);
  });
  it("keeps forward history on a no-op and discards it on a new destination", () => {
    let history = navigationReducer(createNavigationHistory(start), {
      type: "navigate",
      next: { view: "files" },
    });
    history = navigationReducer(history, { type: "back" });
    expect(
      navigationReducer(history, {
        type: "navigate",
        next: { view: "overview" },
      }),
    ).toBe(history);
    history = navigationReducer(history, {
      type: "navigate",
      next: { view: "findings", findingId: "issue" },
    });
    expect(history.forward).toEqual([]);
    expect(history.back).toEqual([start]);
  });
  it("bounds history, safely handles the ends, and isolates report snapshots", () => {
    let history = createNavigationHistory(start);
    expect(navigationReducer(history, { type: "back" })).toBe(history);
    expect(navigationReducer(history, { type: "forward" })).toBe(history);
    for (let i = 0; i < 40; i++)
      history = navigationReducer(history, {
        type: "navigate",
        next: { view: "files", fileId: String(i) },
      });
    expect(history.back).toHaveLength(30);
    history = navigationReducer(history, { type: "reset", position: start });
    expect(history).toEqual(createNavigationHistory(start));
  });
});
