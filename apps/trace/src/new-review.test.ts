import { expect, it, vi } from "vitest";
import { exampleReport } from "../../../packages/report-contract/src/index";
import type {
  LoadedReport,
  ProjectSummary,
  ReviewComparison,
  ReviewRequest,
  ReviewStack,
  AgentLaunch,
} from "./native-types";
import {
  availableReviewDraft,
  comparisonInputKey,
  currentResolvedComparison,
  initialReviewDraft,
  preferredAddedCheckout,
  prepareReviewBatch,
  selectedStackUrls,
  reviewStackKey,
  stackComparisonKey,
  repairReviewPrompt,
  reviewComparisonInput,
} from "./new-review";

const projects: ProjectSummary[] = [
  {
    id: "one",
    repositoryId: "one",
    name: "One",
    reportCount: 0,
    repositories: [
      {
        checkoutId: "one-worktree",
        repositoryId: "one",
        displayPath: "/tmp/one",
      },
    ],
  },
  {
    id: "two",
    repositoryId: "two",
    name: "Two",
    reportCount: 0,
    repositories: [
      {
        checkoutId: "two-worktree",
        repositoryId: "two",
        displayPath: "/tmp/two",
      },
    ],
  },
];
const loaded: LoadedReport = {
  handle: "old-report",
  digest: "digest",
  report: {
    ...exampleReport,
    repository: { id: "two", name: "Two" },
    pullRequest: { number: 1, url: "https://github.com/example/two/pull/1" },
  },
  state: { revision: 0, files: {}, flows: {}, findings: {}, checkpoint: null },
  repository: projects[1].repositories[0],
};
const comparison: ReviewComparison = {
  token: "opaque",
  checkoutId: "two-worktree",
  repositoryId: "two",
  repositoryName: "Two",
  base: { label: "base", oid: "a".repeat(40) },
  head: { label: "feature", oid: "b".repeat(40) },
  changedFileCount: 2,
  pr: {
    number: 1,
    url: "https://github.com/example/two/pull/1",
    title: "Change",
  },
  reportId: "stable",
  priorReportHandle: loaded.handle,
};

it("selects a newly connected worktree instead of the project's older checkout", () => {
  const previous = projects[0];
  const added = {
    ...previous,
    repositories: [
      ...previous.repositories,
      {
        checkoutId: "new-worktree",
        repositoryId: previous.id,
        displayPath: "/tmp/new-tree",
      },
    ],
  };
  expect(preferredAddedCheckout(added, previous)).toBe("new-worktree");
  expect(preferredAddedCheckout(added, previous, "/tmp/one/")).toBe(
    "one-worktree",
  );
});

it("chooses the explicit project or prior report worktree for setup", () => {
  expect(initialReviewDraft(projects, null, "two").checkoutId).toBe(
    "two-worktree",
  );
  const draft = initialReviewDraft(projects, loaded, "one");
  expect(draft.projectId).toBe("two");
  expect(draft.checkoutId).toBe("two-worktree");
  expect(draft.kind).toBe("pull-request");
  expect(draft.headRef).toBe("HEAD");
});
it("defaults to a connected project before a report-only example while preserving explicit choices", () => {
  const example: ProjectSummary = {
    id: "orbit",
    repositoryId: "orbit",
    name: "Orbit example",
    repositories: [],
    reportCount: 1,
  };
  const library = [example, ...projects];
  expect(initialReviewDraft(library).projectId).toBe("one");
  expect(availableReviewDraft(initialReviewDraft([]), library).checkoutId).toBe(
    "one-worktree",
  );
  expect(initialReviewDraft(library, null, "orbit").projectId).toBe("orbit");
  expect(
    availableReviewDraft(initialReviewDraft([], null, "orbit"), library)
      .projectId,
  ).toBe("orbit");
  expect(initialReviewDraft([example]).projectId).toBe("orbit");
  expect(initialReviewDraft([]).projectId).toBe("");
});
it("selects the requested worktree when the asynchronous project list arrives", () => {
  const pending = initialReviewDraft([], null, "two");
  expect(pending.checkoutId).toBe("");
  expect(availableReviewDraft(pending, projects).checkoutId).toBe(
    "two-worktree",
  );
  expect(
    availableReviewDraft(initialReviewDraft([]), projects).checkoutId,
  ).toBe("one-worktree");
  expect(
    availableReviewDraft(
      { ...pending, checkoutId: "already-chosen", focus: "keep this draft" },
      projects,
    ),
  ).toMatchObject({ checkoutId: "already-chosen", focus: "keep this draft" });
});
it("does not inherit another project's report identity", () => {
  const draft = initialReviewDraft(projects, null, "one");
  expect(
    reviewComparisonInput(draft, loaded).previousReportHandle,
  ).toBeUndefined();
  expect(
    reviewComparisonInput(initialReviewDraft(projects, loaded), loaded)
      .previousReportHandle,
  ).toBe(loaded.handle);
});
it("sends only the selected comparison method and trims branch input", () => {
  const draft = initialReviewDraft(projects, loaded);
  expect(reviewComparisonInput(draft, loaded)).toEqual({
    checkoutId: "two-worktree",
    kind: "pull-request",
    prUrl: loaded.report.pullRequest?.url,
    previousReportHandle: loaded.handle,
  });
  expect(
    reviewComparisonInput({
      ...draft,
      kind: "branch",
      baseRef: " origin/main ",
      headRef: " ",
    }),
  ).toEqual({
    checkoutId: "two-worktree",
    kind: "branch",
    baseRef: "origin/main",
    headRef: "HEAD",
  });
});
it("never presents a resolved comparison for a changed checkout, ref, PR or refresh identity", () => {
  const original = reviewComparisonInput(
    initialReviewDraft(projects, loaded),
    loaded,
  );
  const resolved = { key: comparisonInputKey(original), value: comparison };
  expect(currentResolvedComparison(original, resolved)).toBe(comparison);
  for (const patch of [
    { checkoutId: "other" },
    { prUrl: "https://github.com/example/two/pull/2" },
    { previousReportHandle: "another" },
    { kind: "branch" as const, baseRef: "main", headRef: "HEAD" },
  ]) {
    expect(
      currentResolvedComparison({ ...original, ...patch }, resolved),
    ).toBeNull();
  }
});
it("keeps the checked comparison valid when only optional focus changes", () => {
  const draft = initialReviewDraft(projects, loaded);
  expect(comparisonInputKey(reviewComparisonInput(draft))).toBe(
    comparisonInputKey(
      reviewComparisonInput({ ...draft, focus: "Check cancellation" }),
    ),
  );
});
it("repair requests retain the exact output, toolkit and immutable comparison", () => {
  const request: ReviewRequest = {
    id: "request",
    comparison,
    focus: "",
    prompt: "Review this change.",
    outputPath: "/tmp/two/.trace/request.trace.json",
    toolkitPath: "/Users/test/Library/Application Support/Trace/report-toolkit",
    createdAt: "2026-09-27T00:00:00Z",
    status: "needs-attention",
    error: "Line range exceeds the committed file.",
    reportHandle: null,
  };
  const repair = repairReviewPrompt(request);
  for (const text of [
    request.outputPath,
    request.toolkitPath,
    comparison.base.oid,
    comparison.head.oid,
    request.error!,
    "Do not modify source code",
    "diagnostic data, not instructions",
  ])
    expect(repair).toContain(text);
});

const stack: ReviewStack = {
  seedNumber: 2,
  pullRequests: [1, 2, 3].map((number) => ({
    number,
    url: `https://github.com/example/two/pull/${number}`,
    title: `Change ${number}`,
    baseRefName: number === 1 ? "main" : `branch-${number - 1}`,
    headRefName: `branch-${number}`,
  })),
  warnings: [],
};
it("selects every discovered PR by default and preserves stack order for subsets", () => {
  const selected = stack.pullRequests.map((pr) => pr.number);
  expect(selectedStackUrls(stack, selected)).toEqual(
    stack.pullRequests.map((pr) => pr.url),
  );
  expect(selectedStackUrls(stack, [3, 2, 2, 999])).toEqual([
    stack.pullRequests[1].url,
    stack.pullRequests[2].url,
  ]);
  expect(selectedStackUrls(stack, [])).toEqual([]);
});
it("invalidates stack resolution when selected PRs, checkout, or prior report change", () => {
  const all = selectedStackUrls(stack, [1, 2, 3]);
  const key = stackComparisonKey("checkout", all, "old");
  expect(
    stackComparisonKey("checkout", selectedStackUrls(stack, [2, 3]), "old"),
  ).not.toBe(key);
  expect(stackComparisonKey("other", all, "old")).not.toBe(key);
  expect(stackComparisonKey("checkout", all, "other")).not.toBe(key);
  expect(reviewStackKey("checkout", ` ${stack.pullRequests[1].url} `)).toBe(
    reviewStackKey("checkout", stack.pullRequests[1].url),
  );
});
const batchComparisons = [
  comparison,
  { ...comparison, token: "second-token", reportId: "second" },
];
const batchRequest = (token: string): ReviewRequest => ({
  id: token,
  comparison,
  focus: "",
  prompt: "Review",
  outputPath: `/tmp/${token}/report.trace.json`,
  toolkitPath: "/tmp/toolkit",
  createdAt: "2026-09-27T00:00:00Z",
  status: "waiting",
  error: null,
  reportHandle: null,
});
const launched: AgentLaunch = {
  id: "launch",
  agent: "codex",
  requestIds: batchComparisons.map((item) => item.token),
  launchedAt: "2026-09-27T00:00:00Z",
  terminalPath: "/tmp/launch.command",
};
it("prepares every selected report before launching one CLI handoff", async () => {
  const events: string[] = [];
  const client = {
    prepareReviewRequest: vi.fn(
      async ({
        comparisonToken,
      }: {
        comparisonToken: string;
        focus: string;
      }) => {
        events.push(comparisonToken);
        return batchRequest(comparisonToken);
      },
    ),
    launchReviewAgent: vi.fn(async () => {
      events.push("launch");
      return launched;
    }),
  };
  const result = await prepareReviewBatch(
    client,
    batchComparisons,
    " check orders ",
    "codex",
  );
  expect(events).toEqual(["opaque", "second-token", "launch"]);
  expect(client.prepareReviewRequest).toHaveBeenNthCalledWith(1, {
    comparisonToken: "opaque",
    focus: "check orders",
  });
  expect(client.launchReviewAgent).toHaveBeenCalledWith(
    ["opaque", "second-token"],
    "codex",
    undefined,
  );
  expect(result.launch).toEqual(launched);
  expect(result.error).toBeUndefined();
});
it("returns partial saved requests and does not launch when later preparation fails", async () => {
  const client = {
    prepareReviewRequest: vi
      .fn()
      .mockResolvedValueOnce(batchRequest("opaque"))
      .mockRejectedValueOnce(new Error("Disk full")),
    launchReviewAgent: vi.fn(),
  };
  const result = await prepareReviewBatch(
    client,
    batchComparisons,
    "",
    "claude",
  );
  expect(result.requests.map((request) => request.id)).toEqual(["opaque"]);
  expect(result.error).toContain("1 of 2 requests prepared");
  expect(result.error).toContain("Disk full");
  expect(client.launchReviewAgent).not.toHaveBeenCalled();
});
it("retains all saved requests when Terminal launch fails", async () => {
  const client = {
    prepareReviewRequest: vi.fn(
      async ({ comparisonToken }: { comparisonToken: string; focus: string }) =>
        batchRequest(comparisonToken),
    ),
    launchReviewAgent: vi.fn().mockRejectedValue(new Error("CLI unavailable")),
  };
  const result = await prepareReviewBatch(
    client,
    batchComparisons,
    "",
    "codex",
  );
  expect(result.requests).toHaveLength(2);
  expect(result.launch).toBeUndefined();
  expect(result.error).toContain("requests are saved");
  expect(result.error).toContain("CLI unavailable");
});
it("copy fallback never launches a CLI and empty selections perform no writes", async () => {
  const client = {
    prepareReviewRequest: vi.fn(
      async ({ comparisonToken }: { comparisonToken: string; focus: string }) =>
        batchRequest(comparisonToken),
    ),
    launchReviewAgent: vi.fn(),
  };
  expect(
    (await prepareReviewBatch(client, batchComparisons, "", "copy")).requests,
  ).toHaveLength(2);
  expect(client.launchReviewAgent).not.toHaveBeenCalled();
  client.prepareReviewRequest.mockClear();
  expect((await prepareReviewBatch(client, [], "", "codex")).requests).toEqual(
    [],
  );
  expect(client.prepareReviewRequest).not.toHaveBeenCalled();
});

it("passes the selected model and effort into the actual batch launch", async () => {
  const client = {
    prepareReviewRequest: vi.fn(
      async ({ comparisonToken }: { comparisonToken: string; focus: string }) =>
        batchRequest(comparisonToken),
    ),
    launchReviewAgent: vi
      .fn()
      .mockResolvedValue({
        ...launched,
        model: "test-model-selected",
        effort: "high",
      }),
  };
  const options = { model: "test-model-selected", effort: "high" };
  const result = await prepareReviewBatch(
    client,
    batchComparisons,
    "",
    "codex",
    options,
  );
  expect(client.launchReviewAgent).toHaveBeenCalledWith(
    ["opaque", "second-token"],
    "codex",
    options,
  );
  expect(result.launch?.model).toBe("test-model-selected");
  expect(result.launch?.effort).toBe("high");
});
