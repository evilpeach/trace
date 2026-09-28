import type { ReviewPosition } from "./review-workspace";

export interface NavigationHistory {
  current: ReviewPosition;
  back: ReviewPosition[];
  forward: ReviewPosition[];
}

export type NavigationAction =
  | { type: "navigate"; next: Partial<ReviewPosition> }
  | { type: "replace"; next: Partial<ReviewPosition> }
  | { type: "reset"; position: ReviewPosition }
  | { type: "back" | "forward" };

export function createNavigationHistory(
  current: ReviewPosition,
): NavigationHistory {
  return { current, back: [], forward: [] };
}

function samePosition(a: ReviewPosition, b: ReviewPosition) {
  return (
    a.view === b.view &&
    a.fileId === b.fileId &&
    a.flowId === b.flowId &&
    a.findingId === b.findingId &&
    a.evidenceId === b.evidenceId
  );
}

/** History is local to a report; opening a different snapshot resets its IDs. */
export function navigationReducer(
  state: NavigationHistory,
  action: NavigationAction,
): NavigationHistory {
  if (action.type === "reset") return createNavigationHistory(action.position);
  if (action.type === "navigate" || action.type === "replace") {
    const current = { ...state.current, ...action.next };
    if (samePosition(current, state.current)) return state;
    return {
      current,
      back:
        action.type === "replace"
          ? state.back
          : [...state.back.slice(-29), state.current],
      forward: [],
    };
  }
  const source = state[action.type];
  const current = source.at(-1);
  if (!current) return state;
  return action.type === "back"
    ? {
        current,
        back: state.back.slice(0, -1),
        forward: [...state.forward, state.current],
      }
    : {
        current,
        back: [...state.back, state.current],
        forward: state.forward.slice(0, -1),
      };
}
