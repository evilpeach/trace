import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from "react";
import type { LoadedReport } from "./native-types";
import { saveReviewSession, type ReviewSession } from "./review-workspace";

const scrollSelector = ".page-scroll, .files-scroll, .finding-main";

/** Persist the primary reading pane; nested diagram/diff scrolls are independent. */
export function useReviewResume(
  loaded: LoadedReport | null,
  session: Omit<ReviewSession, "scrollY">,
  container: RefObject<HTMLDivElement | null>,
) {
  const current = useRef<{
    loaded: LoadedReport;
    session: ReviewSession;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const restoring = useRef(false);
  const [restoreToken, setRestoreToken] = useState(0);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (current.current)
      saveReviewSession(current.current.loaded, current.current.session);
  }, []);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 200);
  }, [flush]);
  const prepareRestore = useCallback(
    (scrollY: number) => {
      flush();
      pendingScroll.current = scrollY;
      setRestoreToken((value) => value + 1);
    },
    [flush],
  );

  useLayoutEffect(() => {
    if (!loaded) {
      current.current = null;
      return;
    }
    const previous = current.current;
    const samePlace =
      previous?.loaded.handle === loaded.handle &&
      previous.session.position.view === session.position.view &&
      previous.session.position.fileId === session.position.fileId &&
      previous.session.position.flowId === session.position.flowId &&
      previous.session.position.findingId === session.position.findingId;
    if (!samePlace && pendingScroll.current === null) {
      const pane =
        container.current?.querySelector<HTMLElement>(scrollSelector);
      if (pane) pane.scrollTop = 0;
    }
    current.current = {
      loaded,
      session: {
        ...session,
        scrollY:
          pendingScroll.current ?? (samePlace ? previous.session.scrollY : 0),
      },
    };
    schedule();
  }, [loaded, session, schedule, container]);

  useLayoutEffect(() => {
    const root = container.current;
    const desired = pendingScroll.current;
    pendingScroll.current = null;
    if (!root || desired === null || !loaded) return;
    restoring.current = true;
    let stopped = false;
    const apply = () => {
      if (stopped) return;
      const pane = root.querySelector<HTMLElement>(scrollSelector);
      if (pane) pane.scrollTop = desired;
    };
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    // Async source and diagram rendering can increase the scrollable height.
    const resize = new ResizeObserver(apply);
    const pane = root.querySelector<HTMLElement>(scrollSelector);
    if (pane) for (const child of pane.children) resize.observe(child);
    const stop = () => {
      stopped = true;
      restoring.current = false;
      observer.disconnect();
      resize.disconnect();
    };
    const keyStop = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        stop();
    };
    root.addEventListener("wheel", stop, { passive: true });
    root.addEventListener("pointerdown", stop, { passive: true });
    root.addEventListener("keydown", keyStop);
    apply();
    const frame = requestAnimationFrame(apply);
    const limit = setTimeout(stop, 5000);
    return () => {
      stopped = true;
      restoring.current = false;
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(limit);
      root.removeEventListener("wheel", stop);
      root.removeEventListener("pointerdown", stop);
      root.removeEventListener("keydown", keyStop);
    };
  }, [
    loaded?.handle,
    container,
    restoreToken,
    session.position.view,
    session.position.fileId,
    session.position.flowId,
    session.position.findingId,
  ]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  return {
    flush,
    prepareRestore,
    onScrollCapture: (event: UIEvent<HTMLDivElement>) => {
      if (
        !restoring.current &&
        event.target instanceof HTMLElement &&
        event.target.matches(scrollSelector) &&
        current.current
      ) {
        current.current.session.scrollY = event.target.scrollTop;
        schedule();
      }
    },
  };
}
