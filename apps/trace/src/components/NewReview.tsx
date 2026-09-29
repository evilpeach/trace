import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  FileCode2,
  Flag,
  Folder,
  GitBranch,
  Info,
  Plus,
  RefreshCw,
  Terminal,
} from "lucide-react";
import type {
  AgentLaunch,
  LoadedReport,
  ReviewAgent,
  ReviewAgentId,
  ReviewAgentOptions,
  ReviewStack,
  ProjectSummary,
  ReviewComparison,
  ReviewRequest,
  ReviewSetup,
  TraceClient,
} from "../native-types";
import {
  availableReviewDraft,
  comparisonInputKey,
  initialReviewDraft,
  preferredAddedCheckout,
  prepareReviewBatch,
  reviewStackKey,
  selectedStackUrls,
  stackComparisonKey,
  repairReviewPrompt,
  reviewComparisonInput,
} from "../new-review";
import type { ReviewDraft } from "../new-review";
import { LocalPathForm } from "./LocalPathForm";
import { AgentLaunchPanel } from "./AgentLaunchPanel";
import { validAgentOptions } from "../agent-settings";
import "../new-review.css";

export interface NewReviewComposerProps {
  client: TraceClient;
  projects: ProjectSummary[];
  initialReport?: LoadedReport | null;
  initialProjectId?: string | null;
  onProjectAdded: (project: ProjectSummary) => void;
  onProjectChange?: (projectId: string) => void;
  onPrepared: (
    requests: ReviewRequest[],
    launch?: AgentLaunch,
    error?: string,
  ) => void;
  onImport: () => void;
  onExample: () => void;
  onBusyChange?: (busy: boolean) => void;
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function ComparisonSummary({ comparison }: { comparison: ReviewComparison }) {
  return (
    <section className="new-review-comparison" aria-label="Resolved comparison">
      <div className="new-review-comparison-grid">
        <div>
          <span>Base</span>
          <strong>{comparison.base.label}</strong>
          <code>{comparison.base.oid}</code>
        </div>
        <ArrowRight size={18} aria-hidden="true" />
        <div>
          <span>Reviewing</span>
          <strong>{comparison.head.label}</strong>
          <code>{comparison.head.oid}</code>
        </div>
      </div>
      <p>
        <Check size={15} />
        {comparison.changedFileCount} changed{" "}
        {comparison.changedFileCount === 1 ? "file" : "files"} · Committed
        snapshots{comparison.pr ? ` · PR #${comparison.pr.number}` : ""}
      </p>
    </section>
  );
}

export function NewReviewComposer({
  client,
  projects,
  initialReport,
  initialProjectId,
  onProjectAdded,
  onProjectChange,
  onPrepared,
  onImport,
  onExample,
  onBusyChange,
}: NewReviewComposerProps) {
  const [storedDraft, setDraft] = useState(() =>
    initialReviewDraft(projects, initialReport, initialProjectId),
  );
  const [addedProject, setAddedProject] = useState<ProjectSummary | null>(null);
  const [setup, setSetup] = useState<ReviewSetup | null>(null);
  const [setupState, setSetupState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [operation, setOperation] = useState<
    "add" | "discover" | "resolve" | "prepare" | null
  >(null);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState<{
    key: string;
    value: ReviewComparison[];
  } | null>(null);
  const [stackResult, setStackResult] = useState<{
    key: string;
    value: ReviewStack;
    selected: number[];
  } | null>(null);
  const [agents, setAgents] = useState<ReviewAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(client.native);
  const [agentError, setAgentError] = useState("");
  const [agentRetry, setAgentRetry] = useState(0);
  const [editing, setEditing] = useState(true);
  const [pathEntry, setPathEntry] = useState(false);
  const [setupRetry, setSetupRetry] = useState(0);
  const alive = useRef(true);
  const operationSequence = useRef(0);
  const selectionVersion = useRef(0);
  const allProjects = addedProject
    ? [...projects.filter((item) => item.id !== addedProject.id), addedProject]
    : projects;
  const draft = availableReviewDraft(storedDraft, allProjects);
  const project = allProjects.find((item) => item.id === draft.projectId);
  const checkout = project?.repositories.find(
    (item) => item.checkoutId === draft.checkoutId,
  );
  const input = reviewComparisonInput(draft, initialReport);
  const stack =
    stackResult?.key === reviewStackKey(draft.checkoutId, draft.prUrl)
      ? stackResult
      : null;
  const selectedUrls = stack
    ? selectedStackUrls(stack.value, stack.selected)
    : [];
  const key =
    draft.kind === "pull-request"
      ? stackComparisonKey(
          draft.checkoutId,
          selectedUrls,
          input.previousReportHandle,
        )
      : comparisonInputKey(input);
  const comparisons =
    resolved &&
    (resolved.key === key ||
      (draft.kind === "pull-request" &&
        resolved.key === `single:${comparisonInputKey(input)}`))
      ? resolved.value
      : [];
  const comparison = comparisons[0] ?? null;
  const busy = operation !== null;
  const inputDisabled = busy || !client.native || setupState === "loading";
  const canResolve =
    !!checkout &&
    client.native &&
    !busy &&
    setupState === "ready" &&
    setup?.checkoutId === draft.checkoutId &&
    (draft.kind === "pull-request"
      ? !!stack && selectedUrls.length > 0
      : !!draft.baseRef.trim());
  const canDiscover =
    !!checkout &&
    client.native &&
    !busy &&
    setupState === "ready" &&
    setup?.checkoutId === draft.checkoutId &&
    !!draft.prUrl.trim();

  useEffect(() => {
    if (!client.native) return;
    let cancelled = false;
    setAgentsLoading(true);
    setAgentError("");
    client
      .getReviewAgents()
      .then((result) => {
        if (!cancelled) setAgents(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setAgents([]);
          setAgentError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, agentRetry]);
  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!client.native || !draft.checkoutId) return;
    let cancelled = false;
    const version = selectionVersion.current;
    setSetupState("loading");
    setSetup(null);
    client
      .getReviewSetup(draft.checkoutId)
      .then((result) => {
        if (cancelled || selectionVersion.current !== version) return;
        setSetup(result);
        setSetupState("ready");
        setDraft((current) =>
          !current.checkoutId || current.checkoutId === result.checkoutId
            ? {
                ...current,
                projectId: draft.projectId,
                checkoutId: result.checkoutId,
                headRef: result.headRef || "HEAD",
                baseRef:
                  initialReport &&
                  initialReport.repository?.checkoutId === result.checkoutId
                    ? current.baseRef
                    : (result.defaultBaseRef ?? ""),
              }
            : current,
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled && selectionVersion.current === version) {
          setSetupState("failed");
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draft.checkoutId, draft.projectId, initialReport, setupRetry]);

  function updateComparison(patch: Partial<ReviewDraft>) {
    if (patch.projectId !== undefined) onProjectChange?.(patch.projectId);
    selectionVersion.current += 1;
    operationSequence.current += 1;
    setDraft((current) => ({
      ...current,
      projectId: draft.projectId,
      checkoutId: draft.checkoutId,
      ...patch,
    }));
    setResolved(null);
    setStackResult(null);
    setEditing(true);
    setError("");
  }
  function setBusyOperation(
    next: "add" | "discover" | "resolve" | "prepare" | null,
  ) {
    onBusyChange?.(next !== null);
    setOperation(next);
  }
  async function addProject(path?: string) {
    if (!client.native || busy) return;
    const sequence = ++operationSequence.current;
    setBusyOperation("add");
    setError("");
    try {
      const result = path
        ? await client.addProjectPath(path)
        : await client.addProject();
      if (!alive.current || sequence !== operationSequence.current) return;
      if (result) {
        setAddedProject(result);
        updateComparison({
          projectId: result.id,
          checkoutId: preferredAddedCheckout(
            result,
            allProjects.find((item) => item.id === result.id),
            path,
          ),
          baseRef: "",
          headRef: "HEAD",
        });
        setPathEntry(false);
        setSetupRetry((value) => value + 1);
        onProjectAdded(result);
      }
    } catch (reason) {
      if (alive.current && sequence === operationSequence.current)
        setError(errorMessage(reason));
    } finally {
      if (alive.current) setBusyOperation(null);
    }
  }
  async function discoverStack() {
    if (!canDiscover) return;
    const sequence = ++operationSequence.current;
    setBusyOperation("discover");
    setError("");
    setResolved(null);
    try {
      const value = await client.discoverReviewStack(
        draft.checkoutId,
        draft.prUrl.trim(),
      );
      if (!alive.current || sequence !== operationSequence.current) return;
      setStackResult({
        key: reviewStackKey(draft.checkoutId, draft.prUrl),
        value,
        selected: value.pullRequests.map((pr) => pr.number),
      });
    } catch (reason) {
      if (alive.current && sequence === operationSequence.current)
        setError(errorMessage(reason));
    } finally {
      if (alive.current && sequence === operationSequence.current)
        setBusyOperation(null);
    }
  }
  async function resolveOnlyPR() {
    if (!canDiscover) return;
    const sequence = ++operationSequence.current;
    setBusyOperation("resolve");
    setError("");
    setResolved(null);
    setStackResult(null);
    try {
      const value = await client.resolveReviewComparison(input);
      if (!alive.current || sequence !== operationSequence.current) return;
      setResolved({
        key: `single:${comparisonInputKey(input)}`,
        value: [value],
      });
      setEditing(false);
    } catch (reason) {
      if (alive.current && sequence === operationSequence.current)
        setError(errorMessage(reason));
    } finally {
      if (alive.current && sequence === operationSequence.current)
        setBusyOperation(null);
    }
  }
  function selectStack(numbers: number[]) {
    operationSequence.current += 1;
    setStackResult((current) =>
      current ? { ...current, selected: numbers } : current,
    );
    setResolved(null);
    setEditing(true);
    setError("");
  }
  async function resolveComparison() {
    if (!canResolve) return;
    const sequence = ++operationSequence.current,
      requestKey = key;
    setBusyOperation("resolve");
    setError("");
    try {
      const value =
        draft.kind === "pull-request"
          ? await client.resolveReviewStack({
              checkoutId: draft.checkoutId,
              urls: selectedUrls,
              ...(input.previousReportHandle
                ? { previousReportHandle: input.previousReportHandle }
                : {}),
            })
          : [await client.resolveReviewComparison(input)];
      if (!alive.current || sequence !== operationSequence.current) return;
      setResolved({ key: requestKey, value });
      setEditing(false);
    } catch (reason) {
      if (alive.current && sequence === operationSequence.current)
        setError(errorMessage(reason));
    } finally {
      if (alive.current && sequence === operationSequence.current)
        setBusyOperation(null);
    }
  }
  async function prepare(
    mode: "copy" | ReviewAgentId,
    options?: ReviewAgentOptions,
  ) {
    if (!comparisons.length || busy || !client.native) return;
    if (
      mode !== "copy" &&
      !agents.some((agent) => agent.id === mode && agent.available)
    )
      return;
    const sequence = ++operationSequence.current;
    setBusyOperation("prepare");
    setError("");
    try {
      const result = await prepareReviewBatch(
        client,
        comparisons,
        draft.focus,
        mode,
        mode === "copy"
          ? undefined
          : validAgentOptions(
              agents.find((agent) => agent.id === mode),
              options,
            ),
      );
      if (!alive.current || sequence !== operationSequence.current) return;
      if (result.error) setError(result.error);
      if (result.requests.length)
        onPrepared(result.requests, result.launch, result.error);
    } finally {
      if (alive.current && sequence === operationSequence.current)
        setBusyOperation(null);
    }
  }

  return (
    <div className="new-review-workspace">
      <header className="new-review-intro">
        <p className="eyebrow">
          {initialReport
            ? "Continue the story"
            : "A little context. The whole picture."}
        </p>
        <h1>
          {initialReport
            ? "What changed since this review?"
            : "What would you like to understand?"}
        </h1>
        <p>
          Turn a pull request or branch into file explanations, connected user
          journeys, and findings you can inspect.
        </p>
      </header>
      <section className="new-review-composer" aria-label="New review composer">
        <div className="new-review-project-row">
          <label>
            <Folder size={16} />
            <select
              aria-label="Project"
              value={draft.projectId}
              disabled={!client.native || busy}
              onChange={(event) => {
                const next = allProjects.find(
                  (item) => item.id === event.target.value,
                );
                updateComparison({
                  projectId: event.target.value,
                  checkoutId: next?.repositories[0]?.checkoutId ?? "",
                  baseRef: "",
                  headRef: "HEAD",
                  prUrl: "",
                });
              }}
            >
              <option value="">Choose a project</option>
              {allProjects.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <span className="new-review-tag">
            {initialReport ? "Refresh review" : "New review"}
          </span>
        </div>
        {project?.repositories.length ? (
          <label className="new-review-field new-review-worktree">
            Worktree
            <select
              aria-label="Worktree"
              disabled={!client.native || busy}
              value={draft.checkoutId}
              onChange={(event) =>
                updateComparison({
                  checkoutId: event.target.value,
                  baseRef: "",
                  headRef: "HEAD",
                })
              }
            >
              {project.repositories.map((item) => (
                <option key={item.checkoutId} value={item.checkoutId}>
                  {item.displayPath}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="new-review-help">
            Connect the local checkout or worktree containing the change.
          </p>
        )}
        <div className="new-review-connect-actions">
          <button
            className="button small"
            disabled={!client.native || busy}
            onClick={() => void addProject()}
          >
            <Plus size={14} />
            {operation === "add" ? "Connecting…" : "Connect repository"}
          </button>
          <button
            className="new-review-text-button"
            disabled={!client.native || busy}
            onClick={() => setPathEntry(!pathEntry)}
            aria-expanded={pathEntry}
          >
            Enter a path
          </button>
        </div>
        {pathEntry ? (
          <LocalPathForm
            label="Absolute repository or worktree path"
            placeholder="/Users/you/Projects/my-app"
            action="Connect this checkout"
            busy={busy}
            onSubmit={(path) => void addProject(path)}
          />
        ) : null}
        {!client.native ? (
          <p className="new-review-note">
            <Info size={16} />
            Local comparisons and request preparation are available in the Trace
            desktop app. You can explore an example or import a report here.
          </p>
        ) : null}
        <div className="new-review-target-heading">
          <div>
            <GitBranch size={19} />
            <h2>
              {comparisons.length > 1
                ? `${comparisons.length} pull requests selected`
                : comparison?.pr
                  ? `PR #${comparison.pr.number} · ${comparison.pr.title}`
                  : draft.kind === "pull-request"
                    ? "Review a pull request"
                    : "Review a branch"}
            </h2>
          </div>
          {comparison ? (
            <button
              className="new-review-text-button"
              disabled={busy}
              onClick={() => setEditing(!editing)}
              aria-expanded={editing}
            >
              {editing ? "Hide options" : "Change"}
            </button>
          ) : null}
        </div>
        {editing || !comparison ? (
          <div className="new-review-target-editor">
            <div
              className="new-review-target-choices"
              role="group"
              aria-label="Review target"
            >
              <button
                disabled={inputDisabled}
                aria-pressed={draft.kind === "pull-request"}
                onClick={() => updateComparison({ kind: "pull-request" })}
              >
                Pull request<span>Use its base and head</span>
              </button>
              <button
                disabled={inputDisabled}
                aria-pressed={draft.kind === "branch"}
                onClick={() => updateComparison({ kind: "branch" })}
              >
                Branch comparison<span>Choose the base explicitly</span>
              </button>
            </div>
            {draft.kind === "pull-request" ? (
              <>
                <label className="new-review-field">
                  Start with one pull request
                  <input
                    type="url"
                    value={draft.prUrl}
                    disabled={inputDisabled}
                    onChange={(event) =>
                      updateComparison({ prUrl: event.target.value })
                    }
                    placeholder="https://github.com/owner/repository/pull/123"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                  />
                  <small>
                    Trace discovers related PRs from their base and head
                    branches. Choose which to include.
                  </small>
                </label>
                <div className="new-review-discover-actions">
                  <button
                    className="button small"
                    disabled={!canDiscover}
                    onClick={() => void discoverStack()}
                  >
                    <GitBranch size={14} />
                    {operation === "discover"
                      ? "Discovering stack…"
                      : "Discover stack"}
                  </button>
                  <button
                    className="new-review-text-button"
                    disabled={!canDiscover}
                    onClick={() => void resolveOnlyPR()}
                  >
                    Review only this PR
                  </button>
                </div>
                {stack ? (
                  <section
                    className="new-review-stack"
                    aria-label="Pull requests in this stack"
                  >
                    <div className="new-review-stack-heading">
                      <strong>
                        {stack.selected.length} of{" "}
                        {stack.value.pullRequests.length} selected
                      </strong>
                      <div>
                        <button
                          className="new-review-text-button"
                          disabled={
                            busy ||
                            stack.selected.length ===
                              stack.value.pullRequests.length
                          }
                          onClick={() =>
                            selectStack(
                              stack.value.pullRequests.map((pr) => pr.number),
                            )
                          }
                        >
                          Select all
                        </button>
                        <button
                          className="new-review-text-button"
                          disabled={busy || !stack.selected.length}
                          onClick={() => selectStack([])}
                        >
                          Select none
                        </button>
                      </div>
                    </div>
                    <div className="new-review-stack-list">
                      {stack.value.pullRequests.map((pr) => (
                        <label key={pr.number}>
                          <input
                            type="checkbox"
                            aria-label={`Select PR #${pr.number}`}
                            checked={stack.selected.includes(pr.number)}
                            disabled={busy}
                            onChange={(event) =>
                              selectStack(
                                event.target.checked
                                  ? [...stack.selected, pr.number]
                                  : stack.selected.filter(
                                      (number) => number !== pr.number,
                                    ),
                              )
                            }
                          />
                          <span>
                            <strong>
                              #{pr.number} · {pr.title}
                              {pr.number === stack.value.seedNumber ? (
                                <small>Starting PR</small>
                              ) : null}
                            </strong>
                            <code>
                              {pr.baseRefName} ← {pr.headRefName}
                            </code>
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="new-review-help">
                      A separate report for each selected PR keeps its own
                      comparison, findings, and review progress.
                    </p>
                    {stack.value.warnings.length ? (
                      <div className="new-review-stack-warnings" role="status">
                        {stack.value.warnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : (
              <div className="new-review-ref-fields">
                <label className="new-review-field">
                  Compare against
                  <input
                    value={draft.baseRef}
                    disabled={inputDisabled}
                    onChange={(event) =>
                      updateComparison({ baseRef: event.target.value })
                    }
                    placeholder="Base branch or commit"
                    spellCheck={false}
                    autoCapitalize="none"
                  />
                  <small>
                    {setup?.baseSource === "previous-report"
                      ? "Suggested from a previous report. Check the base for stacked PRs."
                      : setup?.baseSource === "remote-default"
                        ? "Suggested from the repository’s remote default."
                        : "Choose the intended base, especially for a stacked PR."}
                  </small>
                </label>
                <label className="new-review-field">
                  Reviewing
                  <input
                    value={draft.headRef}
                    disabled={inputDisabled}
                    onChange={(event) =>
                      updateComparison({ headRef: event.target.value })
                    }
                    placeholder="HEAD"
                    spellCheck={false}
                    autoCapitalize="none"
                  />
                  <small>Committed changes only.</small>
                </label>
              </div>
            )}
            <button
              className="button small"
              disabled={!canResolve}
              onClick={() => void resolveComparison()}
            >
              <RefreshCw
                size={14}
                className={operation === "resolve" ? "spin" : ""}
              />
              {setupState === "loading"
                ? "Reading checkout…"
                : operation === "resolve"
                  ? "Checking comparison…"
                  : draft.kind === "pull-request"
                    ? "Check selected comparisons"
                    : "Check comparison"}
            </button>
          </div>
        ) : null}
        {comparisons.length ? (
          <div className="new-review-resolved-list">
            {comparisons.map((item) =>
              comparisons.length > 1 ? (
                <details key={item.token} className="new-review-resolved-pr">
                  <summary>
                    <strong>
                      {item.pr
                        ? `PR #${item.pr.number} · ${item.pr.title}`
                        : item.head.label}
                    </strong>
                    <span>
                      {item.base.label} · {item.base.oid.slice(0, 8)} →{" "}
                      {item.head.label} · {item.head.oid.slice(0, 8)}
                      <br />
                      {item.changedFileCount} changed{" "}
                      {item.changedFileCount === 1 ? "file" : "files"} · Expand
                      exact commits
                    </span>
                  </summary>
                  <ComparisonSummary comparison={item} />
                </details>
              ) : (
                <ComparisonSummary key={item.token} comparison={item} />
              ),
            )}
          </div>
        ) : (
          <p className="new-review-comparison-placeholder">
            Check the comparison to see the exact commits and changed-file count
            before preparing your request.
          </p>
        )}
        <label className="new-review-field new-review-focus">
          Anything specific to look at?
          <span>Optional · the full change is still covered</span>
          <textarea
            rows={3}
            maxLength={4000}
            value={draft.focus}
            disabled={operation === "prepare"}
            onChange={(event) =>
              setDraft((current) => ({ ...current, focus: event.target.value }))
            }
            placeholder="For example, check how dragging a pill updates the order price."
          />
        </label>
        {error ? (
          <div className="new-review-error" role="alert">
            <p>{error}</p>
            {setupState === "failed" ? (
              <button
                className="button small"
                onClick={() => {
                  setError("");
                  setSetupRetry((value) => value + 1);
                }}
              >
                Retry checkout
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="new-review-composer-bottom new-review-run-actions">
          <div>
            <span className="new-review-run-label">
              {operation === "prepare"
                ? "Preparing review requests…"
                : comparisons.length > 1
                  ? `${comparisons.length} separate reports · choose your agent`
                  : "Choose your agent"}
            </span>
            <AgentLaunchPanel
              agents={agents}
              loading={agentsLoading}
              native={client.native}
              disabled={!comparisons.length || busy}
              busy={busy}
              onRun={(agent, options) => void prepare(agent, options)}
            />
          </div>
          <button
            className="new-review-text-button"
            disabled={!comparisons.length || busy || !client.native}
            onClick={() => void prepare("copy")}
          >
            Prepare{" "}
            {comparisons.length > 1
              ? `${comparisons.length} requests`
              : "a request"}{" "}
            to copy instead
          </button>
        </div>
        {agentError ? (
          <p className="new-review-help" role="status">
            Could not check installed agents: {agentError}
          </p>
        ) : null}
        <button
          className="new-review-text-button new-review-refresh-agents"
          disabled={busy || agentsLoading || !client.native}
          onClick={() => setAgentRetry((value) => value + 1)}
        >
          Refresh agents and models
        </button>
      </section>
      <p className="new-review-footer-note">
        <Info size={16} />
        Run opens Terminal and starts the installed Codex or Claude CLI with
        your existing account and normal approval settings. Trace validates the
        report output; it does not track the agent’s execution. You can also
        copy the request to another coding agent.
      </p>
      <div className="new-review-included">
        <div>
          <FileCode2 size={19} />
          <h3>Every changed file</h3>
          <p>A useful TLDR beside its diff.</p>
        </div>
        <div>
          <GitBranch size={19} />
          <h3>The main journey</h3>
          <p>Follow the PR’s central behavior and why it matters.</p>
        </div>
        <div>
          <Flag size={19} />
          <h3>Grounded findings</h3>
          <p>Inspect the code behind each claim.</p>
        </div>
      </div>
      <div className="new-review-quiet-actions">
        <button onClick={onExample}>Explore an example</button>
        <button onClick={onImport}>Import a report</button>
      </div>
    </div>
  );
}

export interface ReviewRequestActivityProps {
  request: ReviewRequest;
  checking: boolean;
  onCheck: () => void;
  onCancel: () => void;
  onOpen: (reportHandle: string) => void;
  onImport: () => void;
  onBack: () => void;
  agents?: ReviewAgent[];
  native?: boolean;
  onLaunch?: (agent: ReviewAgentId, options: ReviewAgentOptions) => void;
  launch?: AgentLaunch;
  launching?: boolean;
  onRefreshAgents?: () => void;
}
function CopyRequest({
  text,
  repair = false,
}: {
  text: string;
  repair?: boolean;
}) {
  const [copyState, setCopyState] = useState<{
    text: string;
    result: "copied" | "failed";
  } | null>(null);
  const current = copyState?.text === text ? copyState.result : null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ text, result: "copied" });
    } catch {
      setCopyState({ text, result: "failed" });
    }
  }
  return (
    <div className="review-request-copy">
      <button className="button primary" onClick={() => void copy()}>
        <Clipboard size={16} />
        {repair ? "Copy repair request" : "Copy prepared request"}
      </button>
      <p role="status" aria-live="polite">
        {current === "copied"
          ? "Copied. Paste this into your coding agent; copying does not start a review."
          : current === "failed"
            ? "Clipboard access is unavailable. Select and copy the request below."
            : "Includes the exact comparison, report instructions, and output location."}
      </p>
      <details open={current === "failed" ? true : undefined}>
        <summary>
          {repair ? "View repair request" : "View prepared request"}
        </summary>
        <textarea
          aria-label={repair ? "Repair request" : "Prepared review request"}
          readOnly
          value={text}
          rows={10}
          onFocus={(event) => event.target.select()}
        />
      </details>
    </div>
  );
}
export function ReviewRequestActivity({
  request,
  checking,
  onCheck,
  onCancel,
  onOpen,
  onImport,
  onBack,
  agents = [],
  native = true,
  onLaunch,
  launch,
  launching = false,
  onRefreshAgents,
}: ReviewRequestActivityProps) {
  const ready = request.status === "ready",
    attention = request.status === "needs-attention",
    cancelled = request.status === "cancelled";
  const heading = ready
    ? "Your review is ready"
    : attention
      ? "The report needs attention"
      : cancelled
        ? "Stopped waiting for this report"
        : launch
          ? `Terminal opened for ${launch.agent === "codex" ? "Codex" : "Claude"}`
          : "Your request is ready";
  const status = ready
    ? "Ready"
    : attention
      ? "Needs attention"
      : cancelled
        ? "Stopped"
        : "Waiting for report";
  return (
    <div className="review-request-workspace">
      <header className="review-request-heading">
        <span>
          {ready ? (
            <Check size={23} />
          ) : attention ? (
            <Flag size={23} />
          ) : (
            <Terminal size={23} />
          )}
        </span>
        <div>
          <h1>{heading}</h1>
          <p>
            {request.comparison.repositoryName} ·{" "}
            {request.comparison.pr
              ? `PR #${request.comparison.pr.number} · ${request.comparison.pr.title}`
              : request.comparison.head.label}
          </p>
        </div>
      </header>
      <section
        className="review-request-card"
        aria-label="Review request activity"
      >
        <div className="review-request-card-heading">
          <div>
            <h2>
              {ready ? "Ready to explore" : "Use your existing coding agent"}
            </h2>
            <p>
              {ready
                ? "The completed report passed import validation."
                : cancelled
                  ? "This request is no longer being checked."
                  : "Trace has prepared the instructions and is waiting for the output file."}
            </p>
          </div>
          <span
            className={`new-review-tag ${attention ? "attention" : ""}`}
            data-status={request.status}
          >
            {status}
          </span>
        </div>
        <ComparisonSummary comparison={request.comparison} />
        {launch ? (
          <div className="review-launch-settings">
            <strong>Requested for the last launch</strong>
            <span>
              {launch.agent === "codex" ? "Codex" : "Claude"} · Model:{" "}
              <code>{launch.model || "CLI default"}</code> · Effort:{" "}
              <code>{launch.effort || "CLI default"}</code>
            </span>
          </div>
        ) : null}
        {ready ? (
          <>
            <p className="new-review-note">
              Import validation checks the report’s structure and source
              references. Open the report to see its coverage and verification
              limits.
            </p>
            <div className="review-request-controls">
              <button
                className="button primary"
                disabled={!request.reportHandle}
                onClick={() => {
                  if (request.reportHandle) onOpen(request.reportHandle);
                }}
              >
                Open review
                <ArrowRight size={16} />
              </button>
              <button className="button" onClick={onBack}>
                Back to workspace
              </button>
            </div>
          </>
        ) : cancelled ? (
          <>
            <p className="new-review-note">
              Stopping waiting does not stop your external agent. Its output can
              still be imported manually.
            </p>
            <div className="review-request-controls">
              <button className="button" onClick={onImport}>
                Import a completed report
              </button>
              <button className="button" onClick={onBack}>
                Back to workspace
              </button>
            </div>
          </>
        ) : (
          <>
            {attention ? (
              <div className="new-review-error" role="alert">
                <h3>Ask your agent to repair the report</h3>
                <p>{request.error ?? "The report did not pass validation."}</p>
                <p>
                  The request is still saved. Repair the same output file, then
                  check again.
                </p>
              </div>
            ) : (
              <ol className="review-request-steps">
                <li>
                  <strong>Open your coding agent.</strong>
                  <p>
                    Run Codex or Claude in Terminal below, or copy the request
                    to another agent. It includes the exact comparison and
                    report toolkit.
                  </p>
                </li>
                <li>
                  <strong>Follow the Terminal session.</strong>
                  <p>
                    Use your existing account and normal approval prompts. Trace
                    does not track the agent’s execution.
                  </p>
                </li>
                <li>
                  <strong>Return here when it finishes.</strong>
                  <p>
                    Trace validates the expected report and adds it to this
                    project. Use Check now to retry immediately.
                  </p>
                </li>
              </ol>
            )}
            <div className="review-request-launch">
              <AgentLaunchPanel
                agents={agents}
                native={native}
                disabled={checking || launching}
                busy={checking || launching}
                launch={launch}
                onRun={onLaunch}
              />
              {onRefreshAgents ? (
                <button
                  className="new-review-text-button new-review-refresh-agents"
                  disabled={!native || checking || launching}
                  onClick={onRefreshAgents}
                >
                  Refresh agents and models
                </button>
              ) : null}
              <p>
                {launching
                  ? "Opening Terminal…"
                  : launch
                    ? "Terminal accepted the launch. Trace does not track whether the CLI is still running; it waits for a valid report. Opening again starts another session."
                    : "Opens Terminal and starts the normal CLI with your existing account and approval settings."}
              </p>
            </div>
            <div className="review-request-paths">
              <div>
                <span>Expected report</span>
                <code>{request.outputPath}</code>
              </div>
              <div>
                <span>Report toolkit</span>
                <code>{request.toolkitPath}</code>
              </div>
            </div>
            <CopyRequest
              text={attention ? repairReviewPrompt(request) : request.prompt}
              repair={attention}
            />
            <div className="review-request-controls">
              <button
                className="button"
                disabled={checking || launching}
                onClick={onCheck}
              >
                <RefreshCw size={15} className={checking ? "spin" : ""} />
                {checking
                  ? "Checking report…"
                  : attention
                    ? "Check repaired report"
                    : "Check now"}
              </button>
              <button
                className="button"
                disabled={checking || launching}
                onClick={onImport}
              >
                Import manually
              </button>
              <button className="new-review-text-button" onClick={onBack}>
                Keep browsing
              </button>
            </div>
            <div className="review-request-stop">
              <button
                className="new-review-text-button"
                disabled={checking || launching}
                onClick={onCancel}
              >
                Stop waiting
              </button>
              <p>
                This stops report checks only. It does not stop any agent
                session you opened.
              </p>
            </div>
          </>
        )}
      </section>
      <p className="new-review-footer-note">
        <Folder size={16} />
        This request stays with your project. You can leave this page and return
        to its activity later.
      </p>
    </div>
  );
}
