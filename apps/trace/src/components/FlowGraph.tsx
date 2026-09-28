import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyNodeChanges,
  Background,
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { ArrowUpRight, Expand, GitBranch, Minus, Plus } from "lucide-react";
import type { Graph, GraphNode } from "@trace/report-contract";
import {
  edgePath,
  FLOW_NODE_WIDTH,
  layoutFlowGraph,
  type FlowLayout,
} from "../flow-layout";
import "@xyflow/react/dist/style.css";
import "./flow-graph.css";

type StepNode = Node<{ step: GraphNode; order: number }, "step">;
type TransitionEdge = Edge<FlowLayout["edges"][number], "transition">;
type CanvasElements = {
  nodes: StepNode[];
  edges: TransitionEdge[];
  layoutVersion: number;
};
type FlowGraphProps = {
  graph: Graph;
  selected: string | null;
  onSelect: (id: string) => void;
  onEvidence: (id: string) => void;
  layoutKey?: string;
};

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2.5;
const FIT_OPTIONS = { padding: 0.16, minZoom: MIN_ZOOM, maxZoom: 1 };

function StepCard({ data }: NodeProps<StepNode>) {
  const { step, order } = data;
  return (
    <div className={`trace-flow-card ${step.kind}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="trace-flow-kind">
        {String(order).padStart(2, "0")} · {step.kind}
        {step.kind === "decision" ? (
          <GitBranch size={14} aria-hidden="true" />
        ) : null}
      </span>
      <strong>{step.label}</strong>
      <small>
        {step.evidenceIds.length
          ? `${step.evidenceIds.length} source ${step.evidenceIds.length === 1 ? "anchor" : "anchors"}`
          : "User trigger"}
      </small>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function Transition({ id, data, markerEnd }: EdgeProps<TransitionEdge>) {
  if (!data) return null;
  return (
    <>
      <BaseEdge id={id} path={edgePath(data.points)} markerEnd={markerEnd} />
      {data.labelLines.length ? (
        <text
          className="trace-flow-edge-label"
          x={data.label.x}
          y={data.label.y - data.labelHeight / 2 + 13}
          textAnchor="middle"
          aria-hidden="true"
        >
          {data.labelLines.map((line, index) => (
            <tspan key={index} x={data.label.x} dy={index ? 18 : 0}>
              {line}
            </tspan>
          ))}
        </text>
      ) : null}
    </>
  );
}

const NODE_TYPES = { step: StepCard };
const EDGE_TYPES = { transition: Transition };
const ARIA_LABELS = {
  "node.a11yDescription.default":
    "Press Enter or Space to inspect this step's source evidence. Press Tab to move to the next step.",
};

function positionElements(graph: Graph, nodes?: StepNode[]): CanvasElements {
  const sizes = new Map(
    nodes?.flatMap((node) =>
      node.measured?.width && node.measured?.height
        ? [
            [
              node.id,
              { width: node.measured.width, height: node.measured.height },
            ] as const,
          ]
        : [],
    ) ?? [],
  );
  const layout = layoutFlowGraph(graph, sizes);
  return {
    nodes: graph.nodes.map((step, index) => ({
      ...nodes?.find((node) => node.id === step.id),
      id: step.id,
      type: "step",
      position: {
        x: layout.nodes.get(step.id)!.x,
        y: layout.nodes.get(step.id)!.y,
      },
      style: { width: FLOW_NODE_WIDTH },
      data: { step, order: index + 1 },
      ariaLabel: `Step ${index + 1}, ${step.kind}: ${step.label}. ${step.evidenceIds.length} source anchors.`,
    })),
    edges: graph.edges.map((edge, index) => ({
      id: layout.edges[index].id,
      source: edge.from,
      target: edge.to,
      type: "transition",
      data: layout.edges[index],
      ariaLabel: edge.label,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--graph-arrow, #8d9d80)",
      },
    })),
    layoutVersion: 0,
  };
}

/** Only this small toolbar subscribes to viewport changes while panning. */
function ViewportControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="trace-flow-navigation">
      <span>Drag to pan · pinch or scroll to zoom</span>
      <div role="group" aria-label="Diagram zoom controls">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => void zoomOut()}
          disabled={zoom <= MIN_ZOOM}
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          className="trace-flow-zoom"
          aria-label={`Zoom ${Math.round(zoom * 100)} percent; reset to 100 percent`}
          title="Reset to 100%"
          onClick={() => void zoomTo(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => void zoomIn()}
          disabled={zoom >= MAX_ZOOM}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="trace-flow-fit"
          onClick={() => void fitView(FIT_OPTIONS)}
          title="Fit every step in view"
        >
          <Expand size={15} /> Fit
        </button>
      </div>
    </div>
  );
}

function GraphCanvas({
  graph,
  selected,
  onSelect,
  layoutKey,
}: Omit<FlowGraphProps, "onEvidence">) {
  const canvasId = useId();
  const [elements, setElements] = useState(() => positionElements(graph));
  const { fitView, zoomIn, zoomOut, zoomTo, getViewport, setViewport } =
    useReactFlow();
  const didMeasure = useRef(false);
  const previousLayoutKey = useRef(layoutKey);
  const renderedNodes = useMemo(
    () =>
      elements.nodes.map((node) => ({
        ...node,
        selected: node.id === selected,
      })),
    [elements.nodes, selected],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange<StepNode>[]) => {
      const selection = changes.find(
        (change) => change.type === "select" && change.selected,
      );
      if (selection?.type === "select") onSelect(selection.id);
      setElements((current) => {
        const dimensionsChanged = changes.some((change) => {
          if (change.type !== "dimensions" || !change.dimensions) return false;
          const measured = current.nodes.find(
            (node) => node.id === change.id,
          )?.measured;
          return (
            measured?.width !== change.dimensions.width ||
            measured?.height !== change.dimensions.height
          );
        });
        const nodes = applyNodeChanges(changes, current.nodes);
        if (!dimensionsChanged) return { ...current, nodes };
        return {
          ...positionElements(graph, nodes),
          layoutVersion: current.layoutVersion + 1,
        };
      });
    },
    [graph, onSelect],
  );

  // Fit once actual label heights are known, without resetting zoom on selection.
  useEffect(() => {
    if (
      !elements.layoutVersion ||
      didMeasure.current ||
      elements.nodes.some((node) => !node.measured?.height)
    )
      return;
    const frame = requestAnimationFrame(() => {
      didMeasure.current = true;
      void fitView(FIT_OPTIONS);
    });
    return () => cancelAnimationFrame(frame);
  }, [elements.layoutVersion, elements.nodes, fitView]);

  const focusAfterLayoutChange = useEffectEvent(() => {
    // Keep the selected step visible when the inspector takes canvas space.
    // Never zoom in past the user's scale or change ordinary selection/pan.
    void fitView(
      selected
        ? {
            ...FIT_OPTIONS,
            nodes: [{ id: selected }],
            maxZoom: getViewport().zoom,
          }
        : FIT_OPTIONS,
    );
  });
  useEffect(() => {
    if (previousLayoutKey.current === layoutKey) return;
    previousLayoutKey.current = layoutKey;
    let measuredFrame = 0;
    // React Flow reads its new bounds through ResizeObserver. A second frame
    // lets that update settle before fitting, without following every drag.
    const layoutFrame = requestAnimationFrame(() => {
      measuredFrame = requestAnimationFrame(focusAfterLayoutChange);
    });
    return () => {
      cancelAnimationFrame(layoutFrame);
      cancelAnimationFrame(measuredFrame);
    };
  }, [layoutKey]);

  return (
    <div className="trace-flow-viewer">
      <ViewportControls />
      <div
        className="trace-flow-canvas"
        role="region"
        aria-label="Interactive journey diagram. Use arrow keys to pan, plus or minus to zoom, zero for 100 percent, F to fit. Tab through steps to inspect evidence."
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
          )
            return;
          const { x, y, zoom } = getViewport();
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [80, 0],
            ArrowRight: [-80, 0],
            ArrowUp: [0, 80],
            ArrowDown: [0, -80],
          };
          if (moves[event.key]) {
            event.preventDefault();
            const [dx, dy] = moves[event.key];
            void setViewport({ x: x + dx, y: y + dy, zoom });
          } else if (["+", "=", "-", "0", "f", "F"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "-") void zoomOut();
            else if (event.key === "0") void zoomTo(1);
            else if (event.key.toLowerCase() === "f") void fitView(FIT_OPTIONS);
            else void zoomIn();
          }
        }}
      >
        <ReactFlow<StepNode, TransitionEdge>
          id={canvasId}
          nodes={renderedNodes}
          edges={elements.edges}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => onSelect(node.id)}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          nodesFocusable
          edgesFocusable={false}
          autoPanOnNodeFocus
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          fitView
          fitViewOptions={FIT_OPTIONS}
          ariaLabelConfig={ARIA_LABELS}
          colorMode="light"
        >
          <Background gap={20} size={1} color="var(--graph-dot, #d4dfc7)" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function FlowGraph({
  graph,
  selected,
  onSelect,
  onEvidence,
  layoutKey,
}: FlowGraphProps) {
  // Switching before/after or stories starts at a fresh, fitted viewport.
  const graphKey = useMemo(() => JSON.stringify(graph), [graph]);
  const labels = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.label])),
    [graph],
  );
  return (
    <>
      <ReactFlowProvider key={graphKey}>
        <GraphCanvas
          graph={graph}
          selected={selected}
          onSelect={onSelect}
          layoutKey={layoutKey}
        />
      </ReactFlowProvider>
      <details className="flow-transcript trace-flow-transcript">
        <summary>
          Read the complete journey as text
          <span>
            {graph.nodes.length} steps · {graph.edges.length} transitions
          </span>
        </summary>
        <ol>
          {graph.nodes.map((node) => (
            <li key={node.id}>
              <button className="text-button" onClick={() => onSelect(node.id)}>
                {node.label}
              </button>
              <span className="muted"> · {node.kind}</span>
              <ul>
                {graph.edges
                  .filter((edge) => edge.from === node.id)
                  .map((edge, index) => (
                    <li key={index}>
                      {edge.label ? `${edge.label} → ` : "Then → "}
                      {labels.get(edge.to)}
                      {edge.evidenceIds.map((id) => (
                        <button
                          key={id}
                          className="inline-link"
                          onClick={() => onEvidence(id)}
                        >
                          Transition evidence
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
