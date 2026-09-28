import { describe, expect, it } from "vitest";
import { formatReportOption } from "./report-label";

const report = {
  prNumber: 335,
  title: "TP/SL in Open orders",
  head: "2032d70ec65f20b25c6cbbd0d6bdb350e6595f01",
};

describe("formatReportOption", () => {
  it.each([
    "PR 335 — TP/SL in Open orders",
    "PR #335 - TP/SL in Open orders",
    "PR335: TP/SL in Open orders",
    "PR #335 · TP/SL in Open orders",
    "Pull request #335 – TP/SL in Open orders",
    "pull request 335: TP/SL in Open orders",
  ])("removes only the redundant matching prefix from %s", (title) => {
    expect(formatReportOption({ ...report, title })).toBe(
      "PR #335 · TP/SL in Open orders · 2032d70",
    );
  });

  it.each([
    "PR #336 — Related changes",
    "PR #3350 — Separate pull request",
    "PR #335 adds TP/SL support",
    "Follow-up to PR #335 — More changes",
    "PR #335/336: Shared behavior",
  ])("preserves an authored title without a matching prefix: %s", (title) => {
    expect(formatReportOption({ ...report, title })).toBe(
      `PR #335 · ${title} · 2032d70`,
    );
  });

  it.each(["PR335", " PR #335 ", "Pull request #335", "PR335 — "])(
    "does not produce an empty duplicate title for %s",
    (title) => {
      expect(formatReportOption({ ...report, title })).toBe("PR #335 · 2032d70");
    },
  );

  it("preserves body mentions and the source title", () => {
    const item = Object.freeze({
      ...report,
      title: "PR #335 — Follow-up to PR #334: TP/SL",
    });
    expect(formatReportOption(item)).toBe(
      "PR #335 · Follow-up to PR #334: TP/SL · 2032d70",
    );
    expect(item.title).toBe("PR #335 — Follow-up to PR #334: TP/SL");
  });

  it("keeps branch review titles intact and identifies their revision", () => {
    expect(
      formatReportOption({ ...report, prNumber: null, title: "PR #335 — Notes" }),
    ).toBe("Branch review · PR #335 — Notes · 2032d70");
  });

  it("distinguishes refreshed reports with the same PR and title", () => {
    expect(formatReportOption(report)).toBe(
      "PR #335 · TP/SL in Open orders · 2032d70",
    );
    expect(formatReportOption({ ...report, head: "b5fadb4425a319b1" })).toBe(
      "PR #335 · TP/SL in Open orders · b5fadb4",
    );
  });
});
