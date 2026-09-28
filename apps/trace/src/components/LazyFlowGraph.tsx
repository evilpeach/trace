import { lazy, Suspense, type ComponentProps } from "react";
import type { FlowGraph as GraphComponent } from "./FlowGraph";
const Graph = lazy(() =>
  import("./FlowGraph").then((module) => ({ default: module.FlowGraph })),
);
export function FlowGraph(props: ComponentProps<typeof GraphComponent>) {
  return (
    <Suspense
      fallback={
        <div className="diagram-loading" role="status">
          Preparing the journey diagram…
        </div>
      }
    >
      <Graph {...props} />
    </Suspense>
  );
}
