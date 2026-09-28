import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleReport } from "@trace/report-contract";
afterEach(() => vi.unstubAllGlobals());
import { createBrowserClient } from "./bridge";
import type { TraceReport } from "@trace/report-contract";
import type { TraceClient } from "./native-types";

async function importFixture(client: TraceClient, report: TraceReport) {
  const handlers: Record<string, () => void> = {};
  vi.stubGlobal("document", {
    createElement: () => ({
      files: [new File([JSON.stringify(report)], "report.trace.json")],
      remove() {},
      addEventListener(name: string, handler: () => void) {
        handlers[name] = handler;
      },
      click() {
        handlers.change();
      },
    }),
    body: { append() {} },
  });
  return (await client.importReport())!;
}

describe("browser report reader boundaries", () => {
  it("keeps native review handoff explicit instead of simulating agent work", async () => {
    const client = createBrowserClient();
    expect(await client.listReviewRequests()).toEqual([]);
    expect(await client.getReviewAgents()).toEqual([]);
    expect(await client.listReviewAgentLaunches()).toEqual([]);
    await expect(
      client.discoverReviewStack(
        "checkout",
        "https://github.com/org/repo/pull/1",
      ),
    ).rejects.toThrow("desktop app");
    await expect(
      client.resolveReviewStack({ checkoutId: "checkout", urls: [] }),
    ).rejects.toThrow("desktop app");
    await expect(
      client.launchReviewAgent(["request"], "codex"),
    ).rejects.toThrow("desktop app");
    await expect(client.getReviewSetup("checkout")).rejects.toThrow(
      "desktop app",
    );
    await expect(
      client.resolveReviewComparison({
        checkoutId: "checkout",
        kind: "branch",
        baseRef: "main",
      }),
    ).rejects.toThrow("desktop app");
    await expect(
      client.prepareReviewRequest({ comparisonToken: "token", focus: "" }),
    ).rejects.toThrow("desktop app");
    await expect(client.checkReviewRequest("request")).rejects.toThrow(
      "desktop app",
    );
    await expect(client.cancelReviewRequest("request")).rejects.toThrow(
      "desktop app",
    );
    await expect(client.importReviewRequest("request")).rejects.toThrow(
      "desktop app",
    );
    await expect(
      client.importReviewRequestPath("request", "/tmp/report.json"),
    ).rejects.toThrow("desktop app");
  });
  it("loads an explicit example with usable sources for unchanged evidence too", async () => {
    const client = createBrowserClient();
    expect(await client.listReports()).toEqual([]);
    const loaded = await client.loadExample();
    expect(loaded.report.provenance.mode).toBe("synthetic-example");
    for (const evidence of loaded.report.evidence) {
      const source = await client.readDiff(loaded.handle, evidence.fileId);
      const lines = source[evidence.side].text!.trimEnd().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(evidence.endLine);
    }
    expect(
      await client.openSource(loaded.handle, loaded.report.evidence[0].id),
    ).toMatchObject({ opened: false });
  });
  it("does not put bundled source under a modified imported example revision or path", async () => {
    const modified = structuredClone(exampleReport);
    modified.files[0].path = "src/something-else.ts";
    const file = new File([JSON.stringify(modified)], "modified.trace.json");
    const handlers: Record<string, () => void> = {};
    const input = {
      files: [file],
      type: "",
      accept: "",
      hidden: false,
      remove() {},
      addEventListener(name: string, fn: () => void) {
        handlers[name] = fn;
      },
      click() {
        handlers.change();
      },
    };
    vi.stubGlobal("document", {
      createElement: () => input,
      body: { append() {} },
    });
    const client = createBrowserClient();
    const loaded = await client.importReport();
    expect(loaded?.report.files[0].path).toBe("src/something-else.ts");
    await expect(
      client.readDiff(loaded!.handle, modified.files[0].id),
    ).rejects.toThrow("exact Git snapshots");
  });
  it("retains decisions when reopening the same generation and rejects stale writes", async () => {
    const client = createBrowserClient();
    const loaded = await client.loadExample();
    const id = loaded.report.files[0].id;
    const state = await client.setDecision(
      loaded.handle,
      "file",
      id,
      "reviewed",
      0,
    );
    expect(state.files[id].decision).toBe("reviewed");
    expect((await client.openReport(loaded.handle)).state).toEqual(state);
    await expect(
      client.setDecision(loaded.handle, "file", id, "unreviewed", 0),
    ).rejects.toThrow("changed");
    expect(
      (await client.setDecision(loaded.handle, "file", id, "unreviewed", 1))
        .files[id],
    ).toBeUndefined();
  });
  it("does not allow cross-report IDs or invalid dispositions", async () => {
    const client = createBrowserClient();
    const loaded = await client.loadExample();
    await expect(
      client.setDecision(loaded.handle, "file", "unknown", "reviewed", 0),
    ).rejects.toThrow("not part");
    await expect(
      client.setDecision(
        loaded.handle,
        "file",
        loaded.report.files[0].id,
        "fixed",
        0,
      ),
    ).rejects.toThrow("Unsupported");
    expect((await client.openReport(loaded.handle)).state.revision).toBe(0);
  });
  it("records checkpoint without modifying report content", async () => {
    const client = createBrowserClient();
    const loaded = await client.loadExample();
    const state = await client.saveCheckpoint(loaded.handle, 0);
    expect(state.checkpoint?.head).toBe(loaded.report.comparison.head.oid);
    expect((await client.openReport(loaded.handle)).report).toEqual(
      loaded.report,
    );
    await expect(client.chooseRepository()).rejects.toThrow("desktop app");
  });
  it("compares against the saved checkpoint without opening it or changing progress", async () => {
    const client = createBrowserClient();
    const first = await client.loadExample();
    expect((await client.getReviewChanges(first.handle)).status).toBe(
      "no-checkpoint",
    );
    const reviewed = await client.setDecision(
      first.handle,
      "file",
      first.report.files[0].id,
      "reviewed",
      first.state.revision,
    );
    await client.saveCheckpoint(first.handle, reviewed.revision);
    expect((await client.getReviewChanges(first.handle)).status).toBe(
      "current",
    );
    const secondReport = structuredClone(exampleReport);
    secondReport.files[1].analysis.tldr = "Revised checkout guidance.";
    secondReport.flows[0].tldr = "Revised flow guidance.";
    const second = await importFixture(client, secondReport);
    const changes = await client.getReviewChanges(second.handle);
    expect(changes).toMatchObject({
      status: "compared",
      baseline: { handle: first.handle, digest: first.digest },
      files: { changed: [{ id: secondReport.files[1].id }], unchanged: 1 },
      flows: { changed: [{ id: secondReport.flows[0].id }] },
      unchangedReviewedFileCount: 1,
    });
    expect(second.state.files[first.report.files[0].id].stale).toBe(false);
    await client.getReviewChanges(first.handle);
    await expect(
      client.setDecision(
        second.handle,
        "file",
        secondReport.files[1].id,
        "reviewed",
        second.state.revision,
      ),
    ).resolves.toBeDefined();
  });
  it("reports added and removed entities instead of treating disappearance as fixed", async () => {
    const client = createBrowserClient();
    const first = await client.loadExample();
    await client.saveCheckpoint(first.handle, first.state.revision);
    const revised = JSON.parse(
      JSON.stringify(exampleReport)
        .replaceAll("file-session", "file-session-new")
        .replaceAll("flow-checkout", "flow-checkout-new")
        .replaceAll("finding-account-race", "finding-account-race-new"),
    ) as TraceReport;
    const next = await importFixture(client, revised);
    const changes = await client.getReviewChanges(next.handle);
    for (const [collection, id] of [
      ["files", "file-session"],
      ["flows", "flow-checkout"],
      ["findings", "finding-account-race"],
    ] as const) {
      expect(changes[collection].added[0].id).toBe(`${id}-new`);
      expect(changes[collection].removed[0].id).toBe(id);
    }
  });
  it("keeps checkpoints within their project and report lineage", async () => {
    const client = createBrowserClient();
    const first = await client.loadExample();
    await client.saveCheckpoint(first.handle, first.state.revision);
    const otherProject = structuredClone(exampleReport);
    otherProject.repository.id = "local:another-project";
    const otherReport = structuredClone(exampleReport);
    otherReport.reportId = "example:another-report";
    for (const report of [otherProject, otherReport]) {
      const next = await importFixture(client, report);
      expect((await client.getReviewChanges(next.handle)).status).toBe(
        "no-checkpoint",
      );
      expect(next.state.files).toEqual({});
    }
  });
  it("conservatively marks new commits changed when the browser cannot verify blobs", async () => {
    const client = createBrowserClient();
    const first = await client.loadExample();
    const reviewed = await client.setDecision(
      first.handle,
      "file",
      first.report.files[0].id,
      "reviewed",
      first.state.revision,
    );
    await client.saveCheckpoint(first.handle, reviewed.revision);
    const revised = structuredClone(exampleReport);
    revised.comparison.head.oid = "c".repeat(40);
    const next = await importFixture(client, revised);
    expect(next.state.files[first.report.files[0].id].stale).toBe(true);
    const changes = await client.getReviewChanges(next.handle);
    expect(changes.files.changed).toHaveLength(exampleReport.files.length);
    expect(changes.unchangedReviewedFileCount).toBe(0);
  });
  it("groups reports by repository and exposes native discovery boundaries", async () => {
    const client = createBrowserClient();
    await client.loadExample();
    const another = structuredClone(exampleReport);
    another.reportId = "example:orbit:another-pr";
    another.title = "Another pull request";
    another.pullRequest = {
      number: 42,
      url: "https://github.com/example/orbit/pull/42",
    };
    const file = new File([JSON.stringify(another)], "another.trace.json");
    const handlers: Record<string, () => void> = {};
    vi.stubGlobal("document", {
      createElement: () => ({
        files: [file],
        remove() {},
        addEventListener(name: string, handler: () => void) {
          handlers[name] = handler;
        },
        click() {
          handlers.change();
        },
      }),
      body: { append() {} },
    });
    const loaded = await client.importReport();
    const projects = await client.listProjects();
    expect(projects).toEqual([
      {
        id: another.repository.id,
        repositoryId: another.repository.id,
        name: another.repository.name,
        repositories: [],
        reportCount: 2,
      },
    ]);
    expect(await client.listReports()).toContainEqual(
      expect.objectContaining({
        handle: loaded?.handle,
        projectId: another.repository.id,
        reportId: another.reportId,
        prNumber: 42,
        prUrl: another.pullRequest.url,
      }),
    );
    expect(await client.discoverReports()).toEqual({
      imported: 0,
      skipped: 0,
      scanned: 0,
      issues: [],
    });
    await expect(client.addProjectPath("/some/local/path")).rejects.toThrow(
      "desktop app",
    );
    await expect(client.addProject()).rejects.toThrow("desktop app");
    expect(
      await client.openFileSource(
        loaded!.handle,
        another.files[0].id,
        "vscode",
      ),
    ).toMatchObject({ opened: false });
  });
});
