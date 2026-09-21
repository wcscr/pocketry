import { useEffect, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import { loadTraceDraft, saveTraceDraft, traceDraftSnapshot } from "@/lib/trace-draft";
import type { TraceAction, TraceState } from "@/state/trace-store";

export type TraceDraftSaveStatus = "disabled" | "loading" | "empty" | "saving" | "saved" | "error";

/** One browser-local recovery copy. Work begun during hydration always wins. */
export function useTraceDraftPersistence(state: TraceState, dispatch: Dispatch<TraceAction>,
  interactionRevision: MutableRefObject<number>, enabled: boolean): TraceDraftSaveStatus {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<TraceDraftSaveStatus>(enabled ? "loading" : "disabled");
  const latest = useRef(state);
  latest.current = state;
  const mounted = useRef(false);
  const savedState = useRef<TraceState | null>(null);
  const writeRevision = useRef(0);
  const loadRevision = useRef(0);
  const loadFailed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flush = useRef(() => {});

  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    const load = ++loadRevision.current;
    const revision = interactionRevision.current;
    void loadTraceDraft().then((draft) => {
      if (!mounted.current || load !== loadRevision.current) return;
      if (draft && interactionRevision.current === revision) dispatch({ type: "TRACE_DRAFT_RESTORED", draft });
      setReady(true);
    }).catch(() => {
      if (!mounted.current || load !== loadRevision.current) return;
      loadFailed.current = true;
      setStatus("error");
      setReady(true);
    });
    return () => { mounted.current = false; loadRevision.current += 1; };
  }, [enabled, dispatch, interactionRevision]);

  useEffect(() => {
    if (!enabled || !ready) return;
    // Do not erase an unreadable recovery copy merely by visiting the app.
    if (loadFailed.current && interactionRevision.current === 0) return;
    loadFailed.current = false;
    if (state === savedState.current) return;
    setStatus("saving");
    const save = () => {
      clearTimeout(timer.current);
      const snapshotState = latest.current;
      const draft = traceDraftSnapshot(snapshotState);
      // Decoding a newly selected image is not a request to clear recovery.
      if (snapshotState.imageUrl && !draft) return;
      const revision = ++writeRevision.current;
      void saveTraceDraft(draft).then(() => {
        savedState.current = snapshotState;
        if (mounted.current && revision === writeRevision.current && latest.current === snapshotState) {
          setStatus(snapshotState.imageUrl ? "saved" : "empty");
        }
      }).catch(() => {
        if (mounted.current && revision === writeRevision.current) setStatus("error");
      });
    };
    flush.current = save;
    // Clear immediately; debounce edits so pointer motion does not repeatedly
    // clone the photo into IndexedDB while a contour is being dragged.
    if (!state.imageUrl) save();
    else timer.current = setTimeout(save, 200);
    return () => { clearTimeout(timer.current); };
  }, [state, ready, enabled, interactionRevision]);

  useEffect(() => {
    if (!enabled) return;
    const flushWhenHidden = () => { if (document.visibilityState === "hidden") flush.current(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.imageUrl && latest.current !== savedState.current) {
        flush.current();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const onPageHide = () => flush.current();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [enabled]);
  return enabled ? status : "disabled";
}
