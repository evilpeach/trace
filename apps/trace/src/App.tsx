import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Clipboard,
  FileCode2,
  Flag,
  FolderOpen,
  GitBranch,
  History,
  Layers,
  LayoutGrid,
  List,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Settings,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import type { TraceReport } from "@trace/report-contract";
import { client } from "./bridge";
import type {
  EntityKind,
  LoadedReport,
  ReportSummary,
  ReviewState,
  ProjectSummary,
  DiscoveryResult,
  ReviewRequest,
  ReviewAgent,
  ReviewAgentId,
  ReviewAgentOptions,
  AgentLaunch,
} from "./native-types";
import { Dialog } from "./components/Dialog";
import { LocalPathForm } from "./components/LocalPathForm";
import { SettingsPanel } from "./components/SettingsPanel";
import { ProjectSidebar, ProjectLibrary } from "./components/Projects";
import {
  NewReviewComposer,
  ReviewRequestActivity,
} from "./components/NewReview";
import "./review-creation.css";
import { usePreferences, updatePreferences } from "./preferences";
import { FileReview } from "./components/FileReview";
import {
  createNavigationHistory,
  navigationReducer,
} from "./navigation-history";
import { formatReportOption } from "./report-label";
import {
  formatShortcut,
  matchShortcut,
  type ShortcutAction,
} from "./shortcuts";
import { ReviewChangesBar } from "./components/ReviewChanges";
import { useReviewResume } from "./useReviewResume";
import {
  useReviewWorkspace,
  restoreReviewSession,
  visitReport,
  setPRDone,
  reviewKey,
  getReviewStatus,
  syncReviewInbox,
  recentReviewTargets,
  type FlowSelection,
  type ReviewPosition,
} from "./review-workspace";
import {
  EvidenceLink,
  FindingsView,
  FlowsView,
  Overview,
  evidencePath,
} from "./components/ReportViews";

type Evidence = TraceReport["evidence"][number];
type Modal =
  | "settings"
  | "add-project"
  | "import"
  | "request-import"
  | "repository"
  | "search"
  | "library"
  | "activity"
  | "primer"
  | "skill"
  | "source"
  | "copy"
  | null;
type Position = ReviewPosition;
const viewItems = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "files", label: "Files", icon: FileCode2 },
  { id: "flows", label: "Flows", icon: GitBranch },
  { id: "findings", label: "Findings", icon: Flag },
] as const;
const emptyPosition: Position = {
  view: "overview",
  fileId: "",
  flowId: "",
  findingId: "",
  evidenceId: null,
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const requestStatus = {
  waiting: "Waiting for report",
  "needs-attention": "Needs attention",
  ready: "Report ready",
  cancelled: "Stopped waiting",
} as const;

function Logo() {
  return (
    <svg
      className="trace-mark"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 5h11a5 5 0 0 1 0 10h-4a4 4 0 0 0 0 8h11M5 10V5h5M23 18v5h-5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function orderedRounds(report: TraceReport) {
  const pending = [...report.rounds];
  const result: TraceReport["rounds"] = [];
  const added = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex((round) =>
      round.dependsOn.every((id) => added.has(id)),
    );
    if (index < 0) return [...result, ...pending];
    const [round] = pending.splice(index, 1);
    result.push(round);
    added.add(round.id);
  }
  return result;
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedReport | null>(null);
  const [recent, setRecent] = useState<ReportSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [composerBusy, setComposerBusy] = useState(false);
  const [reviewAgents, setReviewAgents] = useState<ReviewAgent[]>([]);
  const [agentLaunches, setAgentLaunches] = useState<AgentLaunch[]>([]);
  const [surface, setSurface] = useState<"review" | "new-review" | "activity">(
    "new-review",
  );
  const surfaceRef = useRef(surface);
  useEffect(() => {
    surfaceRef.current = surface;
  }, [surface]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [importRequestId, setImportRequestId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    revision: number;
    projectId: string | null;
    report: LoadedReport | null;
  }>({ revision: 0, projectId: null, report: null });
  const librarySequence = useRef(0);
  const [projectScope, setProjectScope] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const scanLock = useRef(false);
  const scanCursor = useRef(0);
  const prefs = usePreferences();
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  function toggleSidebar() {
    if (
      !prefs.sidebarCollapsed &&
      sidebarRef.current?.contains(document.activeElement)
    ) {
      sidebarToggleRef.current?.focus();
    }
    updatePreferences({ sidebarCollapsed: !prefs.sidebarCollapsed });
  }
  const workspace = useReviewWorkspace();
  const resumeReports = useMemo(
    () => recentReviewTargets(workspace, recent),
    [workspace, recent],
  );
  const [navigation, dispatchNavigation] = useReducer(
    navigationReducer,
    emptyPosition,
    createNavigationHistory,
  );
  const position = navigation.current;
  const [flowSelection, setFlowSelection] = useState<FlowSelection>({
    nodeId: null,
    revision: "after",
    evidenceId: null,
  });
  const [resumeNotice, setResumeNotice] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [roundFilter, setRoundFilter] = useState("all");
  const [flowFilter, setFlowFilter] = useState("all");
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [fileLayout, setFileLayout] = useState<"single" | "stack">("single");
  const session = useMemo(
    () => ({
      position,
      flowSelection,
      fileQuery,
      roundFilter,
      flowFilter,
      unreviewedOnly,
      fileLayout,
    }),
    [
      position,
      flowSelection,
      fileQuery,
      roundFilter,
      flowFilter,
      unreviewedOnly,
      fileLayout,
    ],
  );
  const resume = useReviewResume(loaded, session, contentRef);
  const [diffFocused, setDiffFocused] = useState(false);
  const diffLayout = prefs.diffLayout;
  const setDiffLayout = (layout: "split" | "unified") =>
    updatePreferences({ diffLayout: layout });
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copyText, setCopyText] = useState("");
  const [source, setSource] = useState<{
    title: string;
    note: string;
    path?: string;
    anchor?: Evidence;
  } | null>(null);
  const loadedRef = useRef(loaded);
  const loadSequence = useRef(0);
  const saveLock = useRef(false);
  const report = loaded?.report;
  const activeRequest = requests.find((request) => request.id === requestId);
  const visibleRequestCount = requests.filter(
    (request) => request.status !== "cancelled",
  ).length;
  const evidence = report?.evidence.find(
    (item) => item.id === position.evidenceId,
  );
  const rounds = useMemo(() => (report ? orderedRounds(report) : []), [report]);
  const allFiles = useMemo(
    () => (report ? [...report.files, ...report.contextFiles] : []),
    [report],
  );
  const currentFile =
    allFiles.find((file) => file.id === position.fileId) ?? report?.files[0];
  const reviewedCount =
    report?.files.filter(
      (file) =>
        loaded?.state.files[file.id]?.decision === "reviewed" &&
        !loaded.state.files[file.id].stale,
    ).length ?? 0;

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  const refreshLibrary = useCallback(async () => {
    const sequence = ++librarySequence.current;
    const [reports, projects, requests, launches, agents] = await Promise.all([
      client.listReports(),
      client.listProjects(),
      client.listReviewRequests(),
      client.listReviewAgentLaunches(),
      client.getReviewAgents(),
    ]);
    if (sequence !== librarySequence.current) return;
    syncReviewInbox(reports);
    setRecent(reports);
    setProjects(projects);
    setRequests(requests);
    setAgentLaunches(launches);
    setReviewAgents(agents);
    setProjectScope((current) =>
      current && projects.some((project) => project.id === current)
        ? current
        : null,
    );
  }, []);
  const scanReports = useCallback(
    async (manual = false, selectedRequestId?: string) => {
      if (!client.native || scanLock.current) return;
      scanLock.current = true;
      setScanning(true);
      try {
        const result = selectedRequestId
          ? null
          : await client.discoverReports();
        const pending = selectedRequestId
          ? [selectedRequestId]
          : (await client.listReviewRequests())
              .filter(
                (request) =>
                  request.status === "waiting" ||
                  request.status === "needs-attention",
              )
              .map((request) => request.id);
        // Rotate bounded scans so older requests still receive checks when
        // multiple projects have more than one stack waiting.
        const start = pending.length ? scanCursor.current % pending.length : 0;
        const batch = selectedRequestId
          ? pending
          : Array.from(
              { length: Math.min(20, pending.length) },
              (_, index) => pending[(start + index) % pending.length],
            );
        if (!selectedRequestId && pending.length)
          scanCursor.current = (start + batch.length) % pending.length;
        let ready = 0;
        for (const id of batch) {
          const checked = await client.checkReviewRequest(id);
          if (checked.status === "ready") ready += 1;
        }
        setDiscovery(result);
        setDiscoveryError("");
        await refreshLibrary();
        if (ready || result?.imported || manual)
          setNotice(
            ready
              ? `${ready} requested ${ready === 1 ? "report is" : "reports are"} ready in Review activity.`
              : result?.imported
                ? `${result.imported} new ${result.imported === 1 ? "report is" : "reports are"} ready in Projects.`
                : selectedRequestId
                  ? "Request checked. See its current status below."
                  : "Project folders checked. No new reports.",
          );
      } catch (reason) {
        setDiscoveryError(message(reason));
        if (selectedRequestId) setError(message(reason));
      } finally {
        scanLock.current = false;
        setScanning(false);
      }
    },
    [refreshLibrary],
  );
  useEffect(() => {
    void refreshLibrary().catch((reason) =>
      setError(`Could not read projects: ${message(reason)}`),
    );
  }, [refreshLibrary]);
  useEffect(() => {
    if (!prefs.autoDetect || !client.native) return;
    void scanReports();
    const onFocus = () => {
      void scanReports();
    };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => {
      if (!document.hidden) void scanReports();
    }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [prefs.autoDetect, scanReports]);
  const activeProjectId = recent.find(
    (item) => item.handle === loaded?.handle,
  )?.projectId;
  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  function browseProject(id: string | null = null) {
    setProjectScope(id);
    setModal("library");
  }
  function beginNewReview(
    projectId: string | null = null,
    previous: LoadedReport | null = null,
  ) {
    if (busy || saving || composerBusy) return;
    resume.flush();
    setDraft((current) => ({
      revision: current.revision + 1,
      projectId,
      report: previous,
    }));
    setSurface("new-review");
    setModal(null);
    setError("");
  }
  function showRequest(id: string) {
    if (busy || saving || composerBusy) return;
    resume.flush();
    setRequestId(id);
    refreshAgents();
    setSurface("activity");
    setModal(null);
    setError("");
  }
  function returnToReview() {
    if (!loaded) return;
    resume.prepareRestore(restoreReviewSession(loaded).session.scrollY);
    setSurface("review");
  }
  async function stopWaiting(id: string) {
    if (scanning || busy) return;
    setBusy("Stopping report detection");
    try {
      await client.cancelReviewRequest(id);
      await refreshLibrary();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }
  async function addProject(path?: string) {
    if (busy || saving) return;
    setBusy("Adding project");
    setError("");
    try {
      const project = path
        ? await client.addProjectPath(path)
        : await client.addProject();
      if (!project) return;
      await refreshLibrary();
      setProjectScope(project.id);
      setModal("library");
      if (prefs.autoDetect) await scanReports();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const navigate = useCallback((next: Partial<Position>) => {
    dispatchNavigation({ type: "navigate", next });
    setModal(null);
  }, []);
  const goBack = useCallback(() => dispatchNavigation({ type: "back" }), []);
  const goForward = useCallback(
    () => dispatchNavigation({ type: "forward" }),
    [],
  );

  const runShortcut = useEffectEvent(
    (action: ShortcutAction, event: KeyboardEvent) => {
      if (
        modal ||
        ((busy || saving || composerBusy) && action !== "toggleSidebar")
      )
        return;
      const editing =
        event.target instanceof HTMLElement &&
        !!event.target.closest(
          "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']",
        );
      if (editing && action !== "settings" && action !== "search") return;
      if (action === "toggleSidebar") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (action === "settings") {
        event.preventDefault();
        setModal("settings");
        return;
      }
      if (action === "newReview") {
        event.preventDefault();
        beginNewReview(activeProjectId ?? null);
        return;
      }
      if (!loaded || surface !== "review") return;
      event.preventDefault();
      if (action === "back") goBack();
      else if (action === "forward") goForward();
      else if (action === "search") {
        setQuery("");
        setModal("search");
      } else if (action === "focusDiff") {
        if (position.view === "files") setDiffFocused((value) => !value);
      } else {
        navigate({ view: action, evidenceId: null });
      }
    },
  );
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        (event.target instanceof HTMLElement &&
          event.target.closest("[data-shortcut-recorder]"))
      )
        return;
      const action = matchShortcut(event, prefs.shortcuts);
      if (action) runShortcut(action, event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [prefs.shortcuts]);

  async function load(
    operation: () => Promise<LoadedReport | null>,
    label: string,
  ) {
    resume.flush();
    const sequence = ++loadSequence.current;
    setBusy(label);
    setError("");
    try {
      const result = await operation();
      if (sequence !== loadSequence.current) return;
      if (result) {
        const restored = restoreReviewSession(result);
        resume.prepareRestore(restored.session.scrollY);
        setLoaded(result);
        setSurface("review");
        loadedRef.current = result;
        dispatchNavigation({
          type: "reset",
          position: restored.session.position,
        });
        setFlowSelection(restored.session.flowSelection);
        setResumeNotice(restored.notice ?? "");
        setFileQuery(restored.session.fileQuery);
        setRoundFilter(restored.session.roundFilter);
        setFlowFilter(restored.session.flowFilter);
        setUnreviewedOnly(restored.session.unreviewedOnly);
        setFileLayout(restored.session.fileLayout);
        visitReport(result);
        setModal(null);
        refreshLibrary().catch((reason) =>
          setError(
            `Report opened; recent reports could not be refreshed: ${message(reason)}`,
          ),
        );
      }
    } catch (reason) {
      if (sequence === loadSequence.current) setError(message(reason));
    } finally {
      if (sequence === loadSequence.current) setBusy("");
    }
  }

  function beginImport() {
    setError("");
    if (client.native) setModal("import");
    else void load(() => client.importReport(), "Importing report");
  }

  function refreshAgents() {
    void client
      .getReviewAgents()
      .then(setReviewAgents)
      .catch((reason) => setError(message(reason)));
  }

  async function runRequestInAgent(
    id: string,
    agent: ReviewAgentId,
    options?: ReviewAgentOptions,
  ) {
    if (busy || scanning) return;
    setBusy(`Opening ${agent === "codex" ? "Codex" : "Claude"} in Terminal`);
    setError("");
    try {
      const launch = await client.launchReviewAgent([id], agent, options);
      setAgentLaunches((current) => [launch, ...current]);
      setNotice(
        "Sent to Terminal. Follow the agent's prompts there; Trace will check for the report.",
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }

  async function importRequestedReport(path?: string) {
    if (!importRequestId || busy) return;
    setBusy("Checking requested report");
    setError("");
    try {
      const request = path
        ? await client.importReviewRequestPath(importRequestId, path)
        : await client.importReviewRequest(importRequestId);
      if (!request) return;
      await refreshLibrary();
      setModal(null);
      setNotice(
        request.status === "ready"
          ? "Report validated. Open it when you are ready."
          : "This report needs attention. See the validation details below.",
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }

  async function connectRepository(
    selection: "folder" | "file" | "path",
    path?: string,
  ) {
    if (!loaded || busy || saving) return;
    const handle = loaded.handle;
    if (selection !== "path") setModal(null);
    setBusy("Connecting repository");
    setError("");
    try {
      const repository =
        selection === "path"
          ? await client.chooseRepositoryPath(path ?? "")
          : await client.chooseRepository(selection);
      if (!repository) return;
      const result = await client.attachRepository(
        handle,
        repository.checkoutId,
      );
      if (loadedRef.current?.handle === handle) {
        setLoaded(result);
        setModal(null);
        setNotice("Repository connected. Committed source is now available.");
        await refreshLibrary();
        if (prefs.autoDetect) void scanReports();
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }

  async function mutateState(
    operation: (active: LoadedReport) => Promise<ReviewState>,
  ) {
    const active = loadedRef.current;
    if (!active || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await operation(active);
      setLoaded((current) =>
        current?.handle === active.handle && current.digest === active.digest
          ? { ...current, state: saved }
          : current,
      );
    } catch (reason) {
      setError(`Progress was not saved. ${message(reason)}`);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  const saveDecision = (
    kind: EntityKind,
    entityId: string,
    decision: string | null,
  ) =>
    mutateState((active) =>
      client.setDecision(
        active.handle,
        kind,
        entityId,
        decision,
        active.state.revision,
      ),
    );
  async function saveCheckpoint() {
    await mutateState((active) =>
      client.saveCheckpoint(active.handle, active.state.revision),
    );
  }
  async function refreshState() {
    if (!loaded || busy || saving) return;
    const handle = loaded.handle;
    setBusy("Refreshing review");
    setError("");
    try {
      const result = await client.openReport(handle);
      if (loadedRef.current?.handle === handle) setLoaded(result);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }
  function openEvidence(id: string) {
    const anchor = report?.evidence.find((item) => item.id === id);
    if (!anchor) return;
    setFileLayout("single");
    navigate({ view: "files", fileId: anchor.fileId, evidenceId: id });
  }
  async function openSource(anchor: Evidence) {
    if (!loaded || busy) return;
    setBusy("Opening source");
    setError("");
    try {
      const result = await client.openSource(loaded.handle, anchor.id);
      if (result.opened)
        setNotice("Opened the verified source location in VS Code.");
      else {
        setSource({
          title: "Source stays in Trace",
          note:
            result.reason || "The editor could not open this source location.",
          path: result.path
            ? `${result.path}${result.line ? `:${result.line}` : ""}`
            : undefined,
          anchor,
        });
        setModal("source");
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }
  function inspectLine(fileId: string, side: "base" | "head", line: number) {
    if (!report) return;
    const anchor = report.evidence.find(
      (item) =>
        item.fileId === fileId &&
        item.side === side &&
        line >= item.startLine &&
        line <= item.endLine,
    );
    const file = allFiles.find((item) => item.id === fileId);
    const path =
      file && side === "base" && "previousPath" in file && file.previousPath
        ? file.previousPath
        : (file?.path ?? fileId);
    setSource({
      title: `${side === "base" ? "Base" : "Head"} source · line ${line}`,
      note: anchor
        ? `This line belongs to the report’s anchor at lines ${anchor.startLine}–${anchor.endLine}. ${anchor.note ?? ""}`
        : "This line is part of the committed snapshot, but no report anchor references it. You can copy its location; editor handoff is available for verified report anchors.",
      path: `${path}:${line} (${side} ${report.comparison[side].oid})`,
      anchor,
    });
    setModal("source");
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      setCopyText(text);
      setModal("copy");
    }
  }

  const filteredFiles =
    report?.files.filter(
      (file) =>
        (!fileQuery ||
          `${file.path} ${file.analysis.tldr ?? ""}`
            .toLowerCase()
            .includes(fileQuery.toLowerCase())) &&
        (roundFilter === "all" || file.roundId === roundFilter) &&
        (flowFilter === "all" ||
          report.flows
            .find((flow) => flow.id === flowFilter)
            ?.fileIds.includes(file.id)) &&
        (!unreviewedOnly ||
          !loaded?.state.files[file.id] ||
          loaded.state.files[file.id].stale ||
          loaded.state.files[file.id].decision !== "reviewed"),
    ) ?? [];
  const selectedRound = report?.rounds.find(
    (round) =>
      round.id ===
      ("roundId" in (currentFile ?? {})
        ? (currentFile as TraceReport["files"][number]).roundId
        : null),
  );
  const synthetic = report?.provenance.mode === "synthetic-example";
  const activeReviewKey = loaded ? reviewKey(loaded) : null;
  const activeReview = activeReviewKey
    ? workspace.reviews[activeReviewKey]
    : null;
  const reviewDone =
    !!loaded && activeReview?.completedHandle === loaded.handle;
  const currentPRReports = recent.filter(
    (item) => reviewKey(item) === activeReviewKey,
  );
  const reviewStatus = currentPRReports.length
    ? getReviewStatus(workspace, currentPRReports)
    : "new";
  const unseenUpdate = reviewStatus === "updated";
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (value: string) =>
    value.toLowerCase().includes(normalizedQuery);

  return (
    <div
      className={`trace-app ${prefs.sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <aside
        className="app-sidebar"
        id="trace-sidebar"
        ref={sidebarRef}
        hidden={prefs.sidebarCollapsed}
      >
        <div className="window-top" data-tauri-drag-region />
        <div className="brand">
          <Logo />
          <span>Trace</span>
          <span className="version-badge">0.1</span>
        </div>
        <button className="repository-switch" onClick={() => browseProject()}>
          <span className="repository-avatar">
            {(report?.repository.name ?? "T").slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{report?.repository.name ?? "Your workspace"}</strong>
            <small>
              {loaded?.repository
                ? "Local repository connected"
                : report
                  ? "Review report"
                  : "Bring a change into focus"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="sidebar-label">WORKSPACE</span>
        <button
          className={`sidebar-nav ${surface === "new-review" ? "active" : ""}`}
          disabled={!!busy || saving}
          title={`New review${prefs.shortcuts.newReview ? ` (${formatShortcut(prefs.shortcuts.newReview)})` : ""}`}
          onClick={() => beginNewReview(activeProjectId ?? null)}
        >
          <Plus size={17} />
          New review
        </button>
        <button className="sidebar-nav" onClick={() => browseProject()}>
          <History size={17} />
          Review inbox<span className="nav-count">{projects.length}</span>
        </button>
        {requests.length ? (
          <>
            <button
              className={`sidebar-nav ${surface === "activity" ? "active" : ""}`}
              onClick={() => setModal("activity")}
            >
              <Clock3 size={17} />
              Review activity
              <span className="nav-count">{visibleRequestCount}</span>
            </button>
            <div className="request-sidebar-list">
              {requests
                .filter((request) => request.status !== "cancelled")
                .slice(0, 3)
                .map((request) => (
                  <button
                    key={request.id}
                    className="request-sidebar-item"
                    disabled={!!busy || saving}
                    aria-current={
                      surface === "activity" && request.id === requestId
                        ? "page"
                        : undefined
                    }
                    onClick={() => showRequest(request.id)}
                  >
                    <strong>
                      {request.comparison.pr
                        ? `PR #${request.comparison.pr.number}`
                        : request.comparison.head.label}
                    </strong>
                    <span>{request.comparison.repositoryName}</span>
                    <small data-status={request.status}>
                      {requestStatus[request.status]}
                    </small>
                  </button>
                ))}
            </div>
          </>
        ) : null}
        <div className="project-section-heading">
          <span className="sidebar-label">PROJECTS</span>
          <button
            className="icon-button"
            aria-label="Add project"
            title="Add project"
            disabled={!client.native || !!busy}
            onClick={() => setModal("add-project")}
          >
            <Plus size={15} />
          </button>
        </div>
        <ProjectSidebar
          projects={projects}
          reports={recent}
          activeHandle={surface === "review" ? loaded?.handle : undefined}
          activeProject={
            surface === "activity"
              ? activeRequest?.comparison.repositoryId
              : surface === "new-review"
                ? (draft.projectId ?? undefined)
                : activeProjectId
          }
          busy={!!busy || saving}
          onOpen={(handle) => {
            void load(() => client.openReport(handle), "Opening report");
          }}
          onProject={browseProject}
          onCreate={(id) => beginNewReview(id)}
        />
        <div className="sidebar-bottom">
          {report?.domainPrimer?.length || report?.valueDerivations?.length ? (
            <button className="sidebar-nav" onClick={() => setModal("primer")}>
              <BookOpen size={17} />
              Project primer
            </button>
          ) : null}
          <button className="sidebar-nav" onClick={() => setModal("skill")}>
            <Terminal size={17} />
            How reports work
          </button>
          <button
            className="sidebar-nav"
            disabled={!!busy || saving}
            onClick={beginImport}
          >
            <Plus size={17} />
            Import a report
          </button>
          <button className="sidebar-nav" onClick={() => setModal("settings")}>
            <Settings size={17} />
            Settings
            {prefs.shortcuts.settings ? (
              <kbd>{formatShortcut(prefs.shortcuts.settings)}</kbd>
            ) : null}
          </button>
          <div className="local-note">
            <LockKeyhole size={12} />
            {client.native ? "Reviews stay on this Mac" : "Browser preview"}
          </div>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              ref={sidebarToggleRef}
              className="icon-button sidebar-toggle"
              aria-label={
                prefs.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"
              }
              aria-expanded={!prefs.sidebarCollapsed}
              aria-controls="trace-sidebar"
              title={`${prefs.sidebarCollapsed ? "Show" : "Hide"} sidebar${prefs.shortcuts.toggleSidebar ? ` (${formatShortcut(prefs.shortcuts.toggleSidebar)})` : ""}`}
              onClick={toggleSidebar}
            >
              {prefs.sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            {loaded && surface === "review" ? (
              <>
                <button
                  className="icon-button"
                  disabled={!navigation.back.length || !!busy || saving}
                  aria-label="Back to previous selection"
                  title={`Back${prefs.shortcuts.back ? ` (${formatShortcut(prefs.shortcuts.back)})` : ""}`}
                  onClick={goBack}
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  className="icon-button"
                  disabled={!navigation.forward.length || !!busy || saving}
                  aria-label="Forward to next selection"
                  title={`Forward${prefs.shortcuts.forward ? ` (${formatShortcut(prefs.shortcuts.forward)})` : ""}`}
                  onClick={goForward}
                >
                  <ArrowRight size={15} />
                </button>
                <button
                  className="breadcrumb-link"
                  onClick={() => browseProject(activeProjectId ?? null)}
                  title="Browse this project"
                >
                  {activeProject?.name ?? report!.repository.name}
                  <ChevronDown size={12} />
                </button>
                <span className="slash">/</span>
                <select
                  className="breadcrumb-select"
                  aria-label="Switch pull request or report"
                  value={loaded.handle}
                  onChange={(event) => {
                    void load(
                      () => client.openReport(event.target.value),
                      "Opening report",
                    );
                  }}
                  disabled={!!busy || saving}
                >
                  {(recent.some((item) => item.handle === loaded.handle)
                    ? recent.filter(
                        (item) => item.projectId === activeProjectId,
                      )
                    : [
                        {
                          handle: loaded.handle,
                          prNumber: report!.pullRequest?.number ?? null,
                          title: report!.title,
                          head: report!.comparison.head.oid,
                        },
                      ]
                  ).map((item) => (
                    <option key={item.handle} value={item.handle}>
                      {formatReportOption(item)}
                    </option>
                  ))}
                </select>
                <span className="slash breadcrumb-section">/</span>
                <span className="breadcrumb-section" aria-current="page">
                  {viewItems.find((item) => item.id === position.view)?.label}
                </span>
              </>
            ) : (
              <>
                <Logo />
                <button
                  className="breadcrumb-link"
                  onClick={() => browseProject()}
                >
                  Projects
                  <ChevronDown size={12} />
                </button>
                <span className="slash">/</span>
                <span aria-current="page">
                  {surface === "activity" ? "Review activity" : "New review"}
                </span>
                {loaded ? (
                  <button
                    className="text-button return-to-review"
                    onClick={returnToReview}
                  >
                    <ArrowLeft size={13} /> Back to review
                  </button>
                ) : null}
              </>
            )}
          </div>
          <div className="row">
            <button
              className="icon-button topbar-settings"
              aria-label="Open settings"
              onClick={() => setModal("settings")}
            >
              <Settings size={17} />
            </button>
            <span className="runtime-tag">
              {client.native ? "macOS" : "Web preview"}
            </span>
            <button
              className="search-trigger"
              aria-label="Search review"
              disabled={!loaded || surface !== "review"}
              onClick={() => {
                setQuery("");
                setModal("search");
              }}
            >
              <Search size={14} />
              <span>Search review</span>
              {prefs.shortcuts.search ? (
                <kbd>{formatShortcut(prefs.shortcuts.search)}</kbd>
              ) : null}
            </button>
          </div>
        </header>
        {!client.native ? (
          <div className="preview-banner">
            Browser preview · Import and explore reports here. Local Git and VS
            Code handoff are available in the Mac app.
          </div>
        ) : null}
        {synthetic && surface === "review" ? (
          <div className="synthetic-banner">
            <Sparkles size={13} />
            Synthetic example · fictional code and review evidence
          </div>
        ) : null}
        {error ? (
          <div className="app-error" role="alert">
            <AlertCircle size={17} />
            <div>
              <strong>Something needs attention</strong>
              <p>{error}</p>
            </div>
            {loaded && surface === "review" ? (
              <button
                className="button small"
                disabled={!!busy || saving}
                onClick={refreshState}
              >
                <RefreshCw size={13} />
                Refresh report
              </button>
            ) : null}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        {loaded && report ? (
          <div
            className={`review-surface ${diffFocused && position.view === "files" ? "is-code-focused" : ""}`}
            hidden={surface !== "review"}
          >
            <header className="review-header">
              <div className="review-header-topline">
                <div className="eyebrow">
                  <span className="status-dot" />
                  REVIEW WORKSPACE{" "}
                  <span className="muted">
                    /{" "}
                    {new Date(report.generatedAt).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" },
                    )}
                  </span>
                </div>
                <div className="review-file-counts">
                  <span>{report.files.length} changed files</span>
                  <span aria-hidden="true">·</span>
                  <span>{report.contextFiles.length} supporting files</span>
                </div>
              </div>
              <div className="header-main">
                <div>
                  <h1>{report.title}</h1>
                  <div className="review-subtitle">
                    <span className="review-branches">
                      <span
                        className="branch-name base-branch"
                        title={
                          report.comparison.base.label ??
                          report.comparison.base.oid
                        }
                      >
                        {report.comparison.base.label ??
                          report.comparison.base.oid.slice(0, 8)}
                      </span>
                      {report.pullRequest ? (
                        <ArrowLeft size={12} aria-hidden="true" />
                      ) : (
                        <ArrowRight size={12} aria-hidden="true" />
                      )}
                      <span
                        className="branch-tag"
                        title={
                          report.comparison.head.label ??
                          report.comparison.head.oid
                        }
                      >
                        <GitBranch size={11} aria-hidden="true" />
                        <span className="branch-name">
                          {report.comparison.head.label ??
                            report.comparison.head.oid.slice(0, 8)}
                        </span>
                      </span>
                    </span>
                  </div>
                </div>
                <div className="header-actions">
                  {!synthetic ? (
                    <button
                      className="button"
                      disabled={!client.native || !!busy || saving}
                      onClick={() =>
                        beginNewReview(activeProjectId ?? null, loaded)
                      }
                    >
                      <RefreshCw size={14} />
                      Prepare updated report
                    </button>
                  ) : null}
                  <button
                    className={`button ${reviewDone ? "" : "primary"}`}
                    disabled={!!busy || saving}
                    onClick={() => setPRDone(loaded, !reviewDone)}
                    title="Personal review status; does not approve or merge the pull request"
                  >
                    <Check size={14} />
                    {reviewDone ? "Reopen review" : "Mark done"}
                  </button>
                  <button
                    className="button"
                    disabled={!!busy || saving}
                    onClick={saveCheckpoint}
                  >
                    <Check size={14} />
                    {loaded.state.checkpoint
                      ? "Update checkpoint"
                      : "Save checkpoint"}
                  </button>
                  {!synthetic ? (
                    <button
                      className={`button ${loaded.repository ? "" : "primary"}`}
                      title={loaded.repository?.displayPath}
                      disabled={!client.native || !!busy || saving}
                      onClick={() => setModal("repository")}
                    >
                      <FolderOpen size={14} />
                      {loaded.repository
                        ? "Change repository"
                        : "Connect repository"}
                    </button>
                  ) : (
                    <button
                      className="button"
                      onClick={() => setModal("library")}
                    >
                      <History size={14} />
                      Reports
                    </button>
                  )}
                </div>
              </div>
              <nav className="view-tabs" aria-label="Review sections">
                {viewItems.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    aria-current={position.view === id ? "page" : undefined}
                    className={position.view === id ? "active" : ""}
                    title={`${label}${prefs.shortcuts[id] ? ` (${formatShortcut(prefs.shortcuts[id])})` : ""}`}
                    onClick={() => navigate({ view: id, evidenceId: null })}
                  >
                    <Icon size={14} />
                    {label}
                    {id !== "overview" ? (
                      <span>{report[id].length}</span>
                    ) : null}
                  </button>
                ))}
                <div className="file-progress">
                  <span>
                    <i
                      style={{
                        width: `${report.files.length ? (reviewedCount / report.files.length) * 100 : 0}%`,
                      }}
                    />
                  </span>
                  {reviewedCount} of {report.files.length} files reviewed
                </div>
              </nav>
            </header>
            {unseenUpdate ? (
              <div className="review-update-notice" role="status">
                <RefreshCw size={14} />
                <span>
                  A new report is available for this PR. You’re still reading
                  this snapshot.
                </span>
                <button
                  className="text-button"
                  onClick={() => browseProject(activeProjectId ?? null)}
                >
                  View reports
                  <ArrowRight size={13} />
                </button>
              </div>
            ) : null}
            {resumeNotice ? (
              <div className="review-update-notice" role="status">
                <History size={14} />
                <span>{resumeNotice}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss resume notice"
                  onClick={() => setResumeNotice("")}
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}
            <ReviewChangesBar
              key={loaded.handle}
              loaded={loaded}
              saving={saving || !!busy}
              onCheckpoint={saveCheckpoint}
              onEntity={(kind, id) => {
                if (kind === "file") {
                  setFileQuery("");
                  setRoundFilter("all");
                  setFlowFilter("all");
                  setUnreviewedOnly(false);
                  setFileLayout("single");
                }
                navigate(
                  kind === "file"
                    ? { view: "files", fileId: id, evidenceId: null }
                    : kind === "flow"
                      ? { view: "flows", flowId: id, evidenceId: null }
                      : { view: "findings", findingId: id, evidenceId: null },
                );
              }}
              onBaseline={(handle) => {
                void load(
                  () => client.openReport(handle),
                  "Opening checkpoint",
                );
              }}
            />
            <div
              className="workspace-content"
              ref={contentRef}
              onScrollCapture={
                surface === "review" ? resume.onScrollCapture : undefined
              }
            >
              {position.view === "overview" ? (
                <Overview
                  loaded={loaded}
                  onFlow={(id) =>
                    navigate({ view: "flows", flowId: id, evidenceId: null })
                  }
                  onFinding={(id) =>
                    navigate({
                      view: "findings",
                      findingId: id,
                      evidenceId: null,
                    })
                  }
                  onFiles={() => navigate({ view: "files", evidenceId: null })}
                  onPrimer={() => setModal("primer")}
                  onEvidence={openEvidence}
                />
              ) : position.view === "flows" ? (
                <FlowsView
                  key={`${loaded.handle}:${position.flowId}`}
                  loaded={loaded}
                  selectedId={position.flowId}
                  selection={flowSelection}
                  onSelectionChange={setFlowSelection}
                  onSource={openSource}
                  saving={saving}
                  onSelect={(id) => {
                    setFlowSelection({
                      nodeId: null,
                      revision: "after",
                      evidenceId: null,
                    });
                    navigate({ flowId: id, evidenceId: null });
                  }}
                  onEvidence={openEvidence}
                  onFinding={(id) =>
                    navigate({
                      view: "findings",
                      findingId: id,
                      evidenceId: null,
                    })
                  }
                  onDecision={(id, value) => saveDecision("flow", id, value)}
                />
              ) : position.view === "findings" ? (
                <FindingsView
                  loaded={loaded}
                  selectedId={position.findingId}
                  saving={saving}
                  onSelect={(id) =>
                    navigate({ findingId: id, evidenceId: null })
                  }
                  onEvidence={openEvidence}
                  onSource={openSource}
                  onDecision={(id, value) => saveDecision("finding", id, value)}
                  onCopy={copy}
                />
              ) : (
                <div className="files-layout">
                  <aside className="file-explorer">
                    <div className="explorer-label">
                      CHANGED FILES<span>{report.files.length}</span>
                    </div>
                    <label className="search-field">
                      <Search size={14} />
                      <input
                        value={fileQuery}
                        onChange={(event) => setFileQuery(event.target.value)}
                        placeholder="Filter files…"
                        aria-label="Filter changed files"
                      />
                    </label>
                    <select
                      className="filter-select"
                      aria-label="Filter by flow"
                      value={flowFilter}
                      onChange={(event) => setFlowFilter(event.target.value)}
                    >
                      <option value="all">All flows</option>
                      {report.flows.map((flow) => (
                        <option key={flow.id} value={flow.id}>
                          {flow.title}
                        </option>
                      ))}
                    </select>
                    <select
                      className="filter-select"
                      aria-label="Filter by review round"
                      value={roundFilter}
                      onChange={(event) => setRoundFilter(event.target.value)}
                    >
                      <option value="all">All dependency rounds</option>
                      {rounds.map((round) => (
                        <option key={round.id} value={round.id}>
                          {round.title}
                        </option>
                      ))}
                    </select>
                    <div className="file-tree">
                      {[...rounds, { id: "", title: "Unclassified" }].map(
                        (round, index) => {
                          const list = filteredFiles.filter(
                            (file) => (file.roundId ?? "") === round.id,
                          );
                          return list.length ? (
                            <section key={round.id}>
                              <h3>
                                {round.id
                                  ? `${String(index + 1).padStart(2, "0")} `
                                  : ""}
                                {round.title}
                              </h3>
                              {list.map((file) => (
                                <button
                                  key={file.id}
                                  className={`file-nav ${currentFile?.id === file.id ? "selected" : ""}`}
                                  onClick={() => {
                                    setFileLayout("single");
                                    navigate({
                                      view: "files",
                                      fileId: file.id,
                                      evidenceId: null,
                                    });
                                  }}
                                  title={
                                    file.analysis.tldr ?? "File summary missing"
                                  }
                                >
                                  <span className="file-language">
                                    {file.path.endsWith(".tsx")
                                      ? "R"
                                      : (file.path
                                          .split(".")
                                          .at(-1)
                                          ?.slice(0, 3) ?? "F")}
                                  </span>
                                  <span>
                                    <strong>
                                      {file.path.split("/").at(-1)}
                                    </strong>
                                    <small>
                                      {file.path.includes("/")
                                        ? file.path.slice(
                                            0,
                                            file.path.lastIndexOf("/"),
                                          )
                                        : file.status}
                                    </small>
                                  </span>
                                  <span
                                    className={`file-dot ${loaded.state.files[file.id]?.stale ? "stale" : ""}`}
                                    aria-label={
                                      loaded.state.files[file.id]?.stale
                                        ? "Changed since review"
                                        : loaded.state.files[file.id]
                                              ?.decision === "reviewed"
                                          ? "Reviewed"
                                          : "Unreviewed"
                                    }
                                  >
                                    {loaded.state.files[file.id]?.stale
                                      ? "◒"
                                      : loaded.state.files[file.id]
                                            ?.decision === "reviewed"
                                        ? "✓"
                                        : "○"}
                                  </span>
                                </button>
                              ))}
                            </section>
                          ) : null;
                        },
                      )}
                      {!filteredFiles.length ? (
                        <p className="empty-note">
                          No files match these filters.
                        </p>
                      ) : null}
                    </div>
                    <label className="checkbox-filter">
                      <input
                        type="checkbox"
                        checked={unreviewedOnly}
                        onChange={(event) =>
                          setUnreviewedOnly(event.target.checked)
                        }
                      />
                      Needs review only
                    </label>
                    <p className="explorer-help">
                      ORDERED BY DEPENDENCY
                      <br />
                      Understand the contract before following its consumers.
                    </p>
                  </aside>
                  <div className="files-main">
                    <div className="files-mode">
                      <div className="segmented" aria-label="File layout">
                        <button
                          aria-pressed={fileLayout === "single"}
                          onClick={() => setFileLayout("single")}
                        >
                          <List size={13} />
                          Single file
                        </button>
                        <button
                          aria-pressed={fileLayout === "stack"}
                          onClick={() => {
                            setFileLayout("stack");
                            dispatchNavigation({
                              type: "replace",
                              next: { evidenceId: null },
                            });
                          }}
                        >
                          <Layers size={13} />
                          File stack
                        </button>
                      </div>
                      <div className="files-display-controls">
                        <div className="segmented" aria-label="Diff layout">
                          <button
                            aria-pressed={diffLayout === "split"}
                            onClick={() => setDiffLayout("split")}
                          >
                            Split
                          </button>
                          <button
                            aria-pressed={diffLayout === "unified"}
                            onClick={() => setDiffLayout("unified")}
                          >
                            Unified
                          </button>
                        </div>
                        <button
                          className="button small focus-diff-button"
                          aria-pressed={diffFocused}
                          title={
                            diffFocused
                              ? `Restore the report header and file list${prefs.shortcuts.focusDiff ? ` (${formatShortcut(prefs.shortcuts.focusDiff)})` : ""}`
                              : `Give the diff more space${prefs.shortcuts.focusDiff ? ` (${formatShortcut(prefs.shortcuts.focusDiff)})` : ""}`
                          }
                          onClick={() => setDiffFocused((value) => !value)}
                        >
                          {diffFocused ? (
                            <Minimize2 size={14} />
                          ) : (
                            <Maximize2 size={14} />
                          )}
                          {diffFocused ? "Exit focus" : "Focus diff"}
                        </button>
                      </div>
                    </div>
                    <div className="files-scroll">
                      {(fileLayout === "stack"
                        ? filteredFiles
                        : currentFile
                          ? [currentFile]
                          : []
                      ).map((file) => (
                        <FileReview
                          key={`${loaded.digest}:${file.id}:${fileLayout}`}
                          loaded={loaded}
                          file={file}
                          layout={diffLayout}
                          evidence={
                            evidence?.fileId === file.id ? evidence : undefined
                          }
                          stacked={fileLayout === "stack"}
                          reviewRound={
                            fileLayout === "single" ? selectedRound : undefined
                          }
                          saving={saving}
                          onDecision={(id, value) =>
                            saveDecision("file", id, value)
                          }
                          onFlow={(id) =>
                            navigate({
                              view: "flows",
                              flowId: id,
                              evidenceId: null,
                            })
                          }
                          onFinding={(id) =>
                            navigate({
                              view: "findings",
                              findingId: id,
                              evidenceId: null,
                            })
                          }
                          onSource={openSource}
                          onUnanchoredLine={inspectLine}
                        />
                      ))}
                      {!report.files.length ? (
                        <div className="view-empty">
                          <FileCode2 size={30} />
                          <h2>No changed files in this comparison</h2>
                          <p>{report.coverage.note}</p>
                        </div>
                      ) : fileLayout === "stack" && !filteredFiles.length ? (
                        <div className="view-empty">
                          <Search size={28} />
                          <h2>No files match</h2>
                          <p>Change the filters to build another stack.</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <footer className="app-footer">
              <div>
                <span className="status-dot" />
                {synthetic ? "Example report" : "Committed snapshots"}
                <code>
                  {report.comparison.base.oid.slice(0, 8)} →{" "}
                  {report.comparison.head.oid.slice(0, 8)}
                </code>
              </div>
              <span>
                {busy ? (
                  <>
                    <LoaderCircle size={12} className="spin" />
                    {busy}…
                  </>
                ) : saving ? (
                  "Saving progress…"
                ) : loaded.state.checkpoint ? (
                  `Checkpoint ${loaded.state.checkpoint.head.slice(0, 8)} · ${new Date(loaded.state.checkpoint.savedAt).toLocaleDateString()}`
                ) : (
                  "Your decisions stay separate from the report"
                )}
              </span>
            </footer>
          </div>
        ) : null}
        <section
          className="onboarding-workspace"
          hidden={surface !== "new-review"}
          aria-label="Create a review"
        >
          <NewReviewComposer
            key={draft.revision}
            client={client}
            projects={projects}
            onBusyChange={setComposerBusy}
            initialProjectId={draft.projectId}
            initialReport={draft.report}
            onProjectAdded={() => {
              void refreshLibrary().catch((reason) =>
                setError(message(reason)),
              );
            }}
            onPrepared={(prepared, launch, preparationError) => {
              ++librarySequence.current;
              const ids = new Set(prepared.map((request) => request.id));
              setRequests((current) => [
                ...prepared,
                ...current.filter((item) => !ids.has(item.id)),
              ]);
              if (launch) setAgentLaunches((current) => [launch, ...current]);
              refreshAgents();
              if (prepared.length && surfaceRef.current === "new-review") {
                setRequestId(prepared[0].id);
                setSurface("activity");
              }
              setError(preparationError ?? "");
              setNotice(
                launch
                  ? `${prepared.length} review ${prepared.length === 1 ? "request" : "requests"} sent to ${launch.agent === "codex" ? "Codex" : "Claude"} in Terminal.`
                  : `${prepared.length} review ${prepared.length === 1 ? "request" : "requests"} prepared. Find each one in Review activity.`,
              );
            }}
            onImport={beginImport}
            onExample={() => {
              void load(() => client.loadExample(), "Loading example");
            }}
          />
          {resumeReports.length ? (
            <section className="welcome-recent">
              <div className="row between">
                <h2>Pick up where you left off</h2>
                <button
                  className="text-button"
                  onClick={() => setModal("library")}
                >
                  All reports
                  <ArrowRight size={13} />
                </button>
              </div>
              {resumeReports.slice(0, 3).map((item) => (
                <button
                  className="recent-row"
                  key={item.handle}
                  disabled={!!busy}
                  onClick={() =>
                    load(() => client.openReport(item.handle), "Opening report")
                  }
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.repositoryName}</small>
                  </span>
                  <code>{item.head.slice(0, 8)}</code>
                  <ArrowRight size={15} />
                </button>
              ))}
            </section>
          ) : null}
        </section>
        {surface === "activity" ? (
          <section
            className="onboarding-workspace"
            aria-label="Review activity"
          >
            {activeRequest ? (
              <ReviewRequestActivity
                key={activeRequest.id}
                request={activeRequest}
                native={client.native}
                agents={reviewAgents}
                onRefreshAgents={refreshAgents}
                launch={agentLaunches.find((launch) =>
                  launch.requestIds.includes(activeRequest.id),
                )}
                launching={!!busy}
                onLaunch={(agent, options) => {
                  void runRequestInAgent(activeRequest.id, agent, options);
                }}
                checking={scanning || !!busy}
                onCheck={() => {
                  void scanReports(true, activeRequest.id);
                }}
                onCancel={() => {
                  void stopWaiting(activeRequest.id);
                }}
                onOpen={(handle) => {
                  void load(
                    () => client.openReport(handle),
                    "Opening requested report",
                  );
                }}
                onImport={() => {
                  if (activeRequest.status === "cancelled") {
                    beginImport();
                    return;
                  }
                  setError("");
                  setImportRequestId(activeRequest.id);
                  setModal("request-import");
                }}
                onBack={() => setSurface("new-review")}
              />
            ) : (
              <div className="view-empty">
                <h2>Choose a review request</h2>
                <button className="button" onClick={() => setModal("activity")}>
                  View activity
                </button>
              </div>
            )}
          </section>
        ) : null}
      </main>
      <div className="live-notice" role="status" aria-live="polite">
        {notice ? (
          <div className="toast">
            <Check size={15} />
            {notice}
          </div>
        ) : null}
      </div>
      {modal ? (
        <Dialog
          title={
            modal === "settings"
              ? "Settings"
              : modal === "add-project"
                ? "Add a project"
                : modal === "request-import"
                  ? "Match a report to this request"
                  : modal === "import"
                    ? "Import a review"
                    : modal === "search"
                      ? "Go to anything"
                      : modal === "library"
                        ? "Review inbox"
                        : modal === "activity"
                          ? "Review activity"
                          : modal === "primer"
                            ? "A little context goes a long way."
                            : modal === "skill"
                              ? "From code to a clear review"
                              : modal === "repository"
                                ? "Connect the reviewed checkout"
                                : modal === "copy"
                                  ? "Copy this text"
                                  : (source?.title ?? "Source evidence")
          }
          onClose={() => setModal(null)}
          wide={
            modal === "primer" || modal === "library" || modal === "settings"
          }
        >
          {modal === "settings" ? (
            <SettingsPanel native={client.native} />
          ) : null}
          {modal === "activity" ? (
            <div className="request-activity-list">
              <p className="dialog-lead">
                Prepared requests stay with their project. Opening a completed
                report is always your choice.
              </p>
              {requests.map((request) => (
                <button
                  className="request-activity-row"
                  key={request.id}
                  disabled={!!busy || saving}
                  onClick={() => showRequest(request.id)}
                >
                  <Clock3 size={17} />
                  <span>
                    <strong>
                      {request.comparison.pr?.title ||
                        request.comparison.head.label}
                    </strong>
                    <small>
                      {request.comparison.repositoryName} ·{" "}
                      {new Date(request.createdAt).toLocaleString()}
                    </small>
                  </span>
                  <span className="request-status" data-status={request.status}>
                    {requestStatus[request.status]}
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
              {!requests.length ? (
                <p>Create a review request to get started.</p>
              ) : null}
              <button
                className="button primary"
                onClick={() => beginNewReview()}
                disabled={!!busy || saving}
              >
                <Plus size={15} /> New review
              </button>
            </div>
          ) : null}
          {modal === "add-project" ? (
            <>
              <p className="dialog-lead">
                Choose a local Git repository. Its pull requests and reports
                will live together in Projects.
              </p>
              <button
                className="button"
                disabled={!!busy}
                onClick={() => {
                  void addProject();
                }}
              >
                <FolderOpen size={15} />
                Choose project folder
              </button>
              <LocalPathForm
                label="Project folder path"
                placeholder="/Users/you/projects/repository"
                action="Add project"
                busy={!!busy}
                onSubmit={(path) => {
                  void addProject(path);
                }}
              />
              <p className="caption">
                Trace discovers completed <code>.trace/*.trace.json</code>{" "}
                reports in connected project folders. You can register multiple
                worktrees for the same repository.
              </p>
              {error ? (
                <p className="path-error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
          {modal === "import" ? (
            <>
              <p className="dialog-lead">
                Choose a completed .trace.json report, or enter its absolute
                file path.
              </p>
              <div className="dialog-actions">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    load(() => client.importReport(), "Importing report")
                  }
                >
                  <Upload size={14} /> Choose report file
                </button>
              </div>
              <LocalPathForm
                label="Report file path"
                placeholder="/Users/you/reviews/change.trace.json"
                action="Import this report"
                busy={!!busy}
                onSubmit={(path) => {
                  void load(
                    () => client.importReportPath(path),
                    "Importing report",
                  );
                }}
              />
              {error ? (
                <p className="path-error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
          {modal === "request-import" ? (
            <>
              <p className="dialog-lead">
                Choose the completed report from your coding agent. Trace checks
                its repository, report ID, and exact commits against this
                request.
              </p>
              <button
                className="button"
                disabled={!!busy}
                onClick={() => {
                  void importRequestedReport();
                }}
              >
                <Upload size={14} /> Choose report file
              </button>
              <LocalPathForm
                label="Completed report file path"
                placeholder="/Users/you/reviews/report.trace.json"
                action="Validate this report"
                busy={!!busy}
                onSubmit={(path) => {
                  void importRequestedReport(path);
                }}
              />
              {error ? (
                <p className="path-error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
          {modal === "repository" && report ? (
            <>
              <p className="dialog-lead">
                Choose the local checkout for {report.repository.name}. Trace
                will verify that it contains the report’s exact commits and
                source evidence.
              </p>
              <pre className="source-location">
                {report.comparison.base.oid}
                {"\n→ "}
                {report.comparison.head.oid}
              </pre>
              <div className="dialog-actions">
                <button
                  className="button"
                  onClick={() => connectRepository("file")}
                >
                  <FileCode2 size={14} />
                  Choose a file inside it
                </button>
                <button
                  className="button primary"
                  onClick={() => connectRepository("folder")}
                >
                  <FolderOpen size={14} />
                  Choose folder
                </button>
              </div>
              <p className="caption">
                You can also enter the checkout’s absolute folder path. Trace
                will find and verify its Git root.
              </p>
              {client.native ? (
                <LocalPathForm
                  label="Repository folder path"
                  placeholder="/Users/you/projects/repository"
                  action="Connect this checkout"
                  busy={!!busy}
                  onSubmit={(path) => {
                    void connectRepository("path", path);
                  }}
                />
              ) : null}
              {error ? (
                <p className="path-error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
          {modal === "search" ? (
            <>
              <label className="search-field dialog-search">
                <Search size={17} />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a file, flow, or finding…"
                  aria-label="Search report"
                />
              </label>
              {report ? (
                <div className="search-results">
                  {allFiles
                    .filter((file) => matches(file.path))
                    .map((file) => (
                      <button
                        key={file.id}
                        onClick={() => {
                          setFileLayout("single");
                          navigate({
                            view: "files",
                            fileId: file.id,
                            evidenceId: null,
                          });
                        }}
                      >
                        <FileCode2 size={16} />
                        <span>
                          {file.path}
                          <small>
                            {report.files.some((item) => item.id === file.id)
                              ? "Changed file"
                              : "Supporting file"}
                          </small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  {report.flows
                    .filter((flow) => matches(`${flow.title} ${flow.tldr}`))
                    .map((flow) => (
                      <button
                        key={flow.id}
                        onClick={() =>
                          navigate({
                            view: "flows",
                            flowId: flow.id,
                            evidenceId: null,
                          })
                        }
                      >
                        <GitBranch size={16} />
                        <span>
                          {flow.title}
                          <small>Flow story</small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  {report.findings
                    .filter((finding) =>
                      matches(`${finding.title} ${finding.id}`),
                    )
                    .map((finding) => (
                      <button
                        key={finding.id}
                        onClick={() =>
                          navigate({
                            view: "findings",
                            findingId: finding.id,
                            evidenceId: null,
                          })
                        }
                      >
                        <Flag size={16} />
                        <span>
                          {finding.title}
                          <small>
                            {finding.priority ?? "Unclassified"} · {finding.id}
                          </small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                </div>
              ) : (
                <p>Open a report to search its files, flows, and findings.</p>
              )}
            </>
          ) : null}
          {modal === "library" ? (
            <>
              <ProjectLibrary
                projects={projects}
                reports={recent}
                activeHandle={loaded?.handle}
                activeProject={activeProjectId}
                busy={!!busy || saving}
                onOpen={(handle) => {
                  void load(() => client.openReport(handle), "Opening report");
                }}
                onProject={browseProject}
                onCreate={(id) => beginNewReview(id)}
                onAdd={() => setModal("add-project")}
                onScan={() => {
                  void scanReports(true);
                }}
                scanning={scanning}
                native={client.native}
                scope={projectScope}
                onAll={() => setProjectScope(null)}
              />
              {discoveryError ? (
                <p className="path-error" role="alert">
                  Report detection: {discoveryError}
                </p>
              ) : null}
              {discovery?.issues.length ? (
                <details className="discovery-issues">
                  <summary>
                    {discovery.issues.length} report{" "}
                    {discovery.issues.length === 1 ? "needs" : "need"} attention
                  </summary>
                  {discovery.issues.map((issue, index) => (
                    <p key={`${issue.path}:${index}`}>
                      <code>{issue.path}</code>
                      <br />
                      {issue.message}
                    </p>
                  ))}
                </details>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    load(() => client.loadExample(), "Loading example")
                  }
                >
                  <Sparkles size={14} />
                  Explore example
                </button>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={beginImport}
                >
                  <Upload size={14} />
                  Import report
                </button>
              </div>
            </>
          ) : null}
          {modal === "primer" && report ? (
            <>
              <dl className="primer-terms">
                {report.domainPrimer?.map((entry, index) => (
                  <div key={index}>
                    <dt>{entry.term}</dt>
                    <dd>{entry.definition}</dd>
                  </div>
                ))}
              </dl>
              {report.valueDerivations?.length ? (
                <section className="derivations">
                  <h3>How the values are derived</h3>
                  {report.valueDerivations.map((value) => (
                    <details key={value.id}>
                      <summary>{value.value}</summary>
                      <p>{value.tldr}</p>
                      <div className="row">
                        {value.surfaces.map((surface) => (
                          <span className="pill" key={surface}>
                            {surface}
                          </span>
                        ))}
                      </div>
                      <pre>{value.formula}</pre>
                      <p>
                        <strong>Units:</strong> {value.units}
                      </p>
                      <p>
                        <strong>Edge behavior:</strong> {value.edgeBehavior}
                      </p>
                      {value.trace.map((step, index) => (
                        <section key={index}>
                          <p>{step.note}</p>
                          {step.evidenceIds.map((id) => {
                            const anchor = report.evidence.find(
                              (item) => item.id === id,
                            );
                            return anchor ? (
                              <EvidenceLink
                                key={id}
                                report={report}
                                anchor={anchor}
                                onEvidence={openEvidence}
                              />
                            ) : null;
                          })}
                        </section>
                      ))}
                    </details>
                  ))}
                </section>
              ) : null}
            </>
          ) : null}
          {modal === "skill" ? (
            <>
              <p className="dialog-lead">
                Choose a project and a pull request or branch. Trace prepares
                everything your coding agent needs to create the report.
              </p>
              <ol className="report-help-steps">
                <li>
                  <strong>Choose the change.</strong> Confirm the project,
                  worktree, and comparison. A stacked PR can have a different
                  base from the main branch.
                </li>
                <li>
                  <strong>Run with Codex or Claude.</strong> Trace opens the
                  installed CLI in Terminal, or you can copy the request. It
                  includes the skill, schema, validator, exact commits, and
                  output location. You do not need Trace’s source repository or
                  a globally installed skill.
                </li>
                <li>
                  <strong>Return to your report.</strong> Trace checks the
                  completed artifact against the selected comparison. Explore
                  the main journey, file explanations, and source evidence.
                </li>
              </ol>
              <div className="dialog-actions">
                <button
                  className="button primary"
                  disabled={!!busy || saving}
                  onClick={() => beginNewReview(activeProjectId ?? null)}
                >
                  <Plus size={14} /> New review
                </button>
              </div>
              <p className="caption">
                Run with Codex or Claude opens your installed CLI in Terminal
                with the prepared request. Login, approvals, and stopping the
                agent happen there. Review decisions and checkpoints remain
                separate from generated reports.
              </p>
            </>
          ) : null}
          {modal === "source" && source ? (
            <>
              <p className="dialog-lead">{source.note}</p>
              {source.path ? (
                <pre className="source-location">{source.path}</pre>
              ) : null}
              {source.anchor && report ? (
                <div className="source-anchor-info">
                  <span className="pill">{source.anchor.side} snapshot</span>
                  <code>{report.comparison[source.anchor.side].oid}</code>
                  <p>
                    {evidencePath(report, source.anchor)}:
                    {source.anchor.startLine}–{source.anchor.endLine}
                  </p>
                </div>
              ) : null}
              <div className="dialog-actions">
                {source.path ? (
                  <button className="button" onClick={() => copy(source.path!)}>
                    <Clipboard size={14} />
                    Copy location
                  </button>
                ) : null}
                {source.anchor ? (
                  <>
                    <button
                      className="button"
                      onClick={() => openEvidence(source.anchor!.id)}
                    >
                      Inspect anchor
                      <ArrowRight size={14} />
                    </button>
                    <button
                      className="button primary"
                      disabled={!!busy}
                      onClick={() => openSource(source.anchor!)}
                    >
                      Open anchored range in VS Code
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
          {modal === "copy" ? (
            <>
              <p>
                Clipboard access is unavailable. Select and copy the text below.
              </p>
              <textarea
                readOnly
                aria-label="Text to copy"
                value={copyText}
                onFocus={(event) => event.target.select()}
              />
            </>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}
