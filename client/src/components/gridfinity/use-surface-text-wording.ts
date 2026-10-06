import { useEffect, useRef, useState, type Dispatch } from "react";
import { surfaceTextSchema, type SurfaceText } from "@shared/gridfinity/surface-text";
import type { BinHistory } from "@shared/gridfinity/history";
import { extendLocalFont } from "@/lib/gridfinity/local-font";
import { surfaceTextOutline } from "@/lib/gridfinity/surface-text";
import { useBin, type BinAction } from "@/state/bin-store";
import { useExperimentalFeatures } from "@/state/experimental-features";

// A new draft supersedes pending work even if the user selected another label
// and returned, mounting a fresh editor before the old font conversion finished.
const requests = new WeakMap<Dispatch<BinAction>, Map<string, symbol>>();
interface WordingDraft {
  label: SurfaceText;
  history: BinHistory;
  editingEpoch: number;
  text: string;
  token: symbol;
  pending: boolean;
  finished: boolean;
}

/** Finish valid wording when a canvas pointer-down replaces its editor before
 * native blur. Font conversion may outlive that editor; the reducer guards the
 * originating document checkpoint and updates only the original label. */
export function useSurfaceTextWording(label: SurfaceText, options: {
  onDone?: () => void;
  commitOnUnmount?: () => boolean;
} = {}) {
  const { dispatch, history, editingEpoch } = useBin();
  const { enabled } = useExperimentalFeatures();
  const [draft, setDraft] = useState(label.text);
  const [error, setError] = useState<string | null>(null);
  const staged = useRef<WordingDraft | null>(null);
  const mounted = useRef(true);
  const current = useRef({ label, history, options });
  current.current = { label, history, options };
  let requestMap = requests.get(dispatch);
  if (!requestMap) { requestMap = new Map(); requests.set(dispatch, requestMap); }
  const latestRequests = requestMap;
  const cancel = () => {
    const edit = staged.current;
    if (edit && latestRequests.get(edit.label.id) === edit.token) latestRequests.delete(edit.label.id);
    staged.current = null;
  };
  const change = (text: string) => {
    const token = Symbol();
    latestRequests.set(label.id, token);
    staged.current = { label, history, editingEpoch, text, token, pending: false, finished: false };
    setDraft(text); setError(null);
  };
  const commit = () => {
    const edit = staged.current;
    if (!edit) { if (mounted.current) current.current.options.onDone?.(); return; }
    if (edit.pending || edit.finished || latestRequests.get(edit.label.id) !== edit.token) return;
    const fail = (message: string) => {
      if (latestRequests.get(edit.label.id) !== edit.token) return;
      edit.pending = false;
      if (mounted.current) setError(message);
      else latestRequests.delete(edit.label.id);
    };
    const parsed = surfaceTextSchema.safeParse({ ...edit.label, text: edit.text });
    if (!parsed.success) { fail(parsed.error.issues[0].message); return; }
    const save = (font: SurfaceText["font"]) => {
      if (latestRequests.get(edit.label.id) !== edit.token) return;
      try { surfaceTextOutline({ ...parsed.data, font }); }
      catch (cause) { fail(cause instanceof Error ? cause.message : String(cause)); return; }
      edit.finished = true;
      latestRequests.delete(edit.label.id);
      dispatch({ type: "COMMIT_SURFACE_TEXT_WORDING", id: edit.label.id,
        expectedHistory: edit.history, expectedEditingEpoch: edit.editingEpoch, expectedText: edit.label.text, text: edit.text, font });
      if (mounted.current) { setError(null); current.current.options.onDone?.(); }
    };
    const font = edit.label.font;
    if (typeof font !== "string" && font.source && [...edit.text].some(char => !font.glyphs[char])) {
      edit.pending = true;
      void extendLocalFont(font, edit.text).then(save).catch(cause => fail(cause instanceof Error ? cause.message : String(cause)));
    } else save(font);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  // A document change invalidates the old draft; a pure selection change does
  // not change history and instead commits the outgoing editor in cleanup.
  useEffect(() => {
    cancel(); setDraft(label.text); setError(null);
  }, [label.text, label.font, history, enabled]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (current.current.options.commitOnUnmount?.() !== false) commitRef.current();
      else cancel();
    };
  }, []);
  return { draft, error, change, commit, cancel };
}
