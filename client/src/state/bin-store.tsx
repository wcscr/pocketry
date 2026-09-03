import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import type { CutoutPlacement, FingerHole } from "@shared/gridfinity/cutout";
import { parseBinSpec, type BinSpec, type BinSpecInput } from "@shared/gridfinity/types";

/**
 * The bin designer's state: spec + placed cutouts + editor selection. Same
 * reducer-provider shape as the trace store, scoped to the /bin page.
 *
 * Undo/redo covers the **material document** — `{spec, cutouts, fingerHoles}` — and
 * nothing else: selection, view mode and hydration are transient UI state
 * that undoing should not yank around. The stack holds full snapshots with
 * `index` pointing at the present; drag frames dispatch with
 * `transient: true` so a whole gesture collapses into one undo step (the
 * pre-drag snapshot stays at `stack[index]` until the release commits).
 */

export type BinViewMode = "3d" | "2d";
export type BinEditorMode = "placement" | "contour" | "footprint" | "label-edge";

/** What undo restores. */
export interface BinDoc {
  spec: BinSpec;
  cutouts: CutoutPlacement[];
  fingerHoles: FingerHole[];
}

export interface BinHistoryEntry {
  doc: BinDoc;
  /** Human-readable operation that produced this state. */
  label: string;
}

const HISTORY_LIMIT = 50;

export interface BinState {
  spec: BinSpec;
  cutouts: CutoutPlacement[];
  fingerHoles: FingerHole[];
  selectedCutoutId: string | null;
  selectedFingerHoleId: string | null;
  /** Pocket awaiting the user's remove/resize decision. */
  pendingRemovalId: string | null;
  viewMode: BinViewMode;
  /** Active interaction grammar in the 2D layout view. */
  editorMode: BinEditorMode;
  /** True once persistence has had its chance to restore a project. */
  hydrated: boolean;
  history: { stack: BinHistoryEntry[]; index: number };
}

/**
 * The last pointer-up/keyboard commit. Transient slider and drag frames update
 * the visible state but deliberately leave this document unchanged, allowing
 * expensive consumers such as the geometry worker to wait for release.
 */
export function getCommittedBinDoc(
  state: Pick<BinState, "history">,
): BinDoc {
  return state.history.stack[state.history.index].doc;
}

export type BinAction =
  | {
      type: "HYDRATE";
      spec: BinSpec;
      cutouts: CutoutPlacement[];
      fingerHoles?: FingerHole[];
    }
  | { type: "MARK_HYDRATED" }
  | {
      type: "PATCH_SPEC";
      patch: Partial<BinSpecInput>;
      transient?: boolean;
      historyLabel?: string;
    }
  | {
      type: "ADD_PLACED";
      cutouts: CutoutPlacement[];
      gridX: number;
      gridY: number;
      footprint?: BinSpec["footprint"];
      historyLabel?: string;
    }
  | {
      type: "UPDATE_CUTOUT";
      id: string;
      patch: Partial<CutoutPlacement>;
      transient?: boolean;
      historyLabel?: string;
    }
  | { type: "ADD_FINGER_HOLE"; hole: FingerHole }
  | {
      type: "UPDATE_FINGER_HOLE";
      id: string;
      patch: Partial<FingerHole>;
      transient?: boolean;
      historyLabel?: string;
    }
  | { type: "REMOVE_FINGER_HOLE"; id: string }
  | { type: "REQUEST_REMOVE_CUTOUT"; id: string }
  | { type: "CANCEL_REMOVE_CUTOUT" }
  | { type: "REMOVE_CUTOUT"; id: string }
  | { type: "DUPLICATE_CUTOUT"; id: string; newId: string }
  | {
      type: "REPLACE_LAYOUT";
      cutouts: CutoutPlacement[];
      fingerHoles?: FingerHole[];
      gridX: number;
      gridY: number;
      footprint?: BinSpec["footprint"];
      /** Additional spec fields that must move atomically with the layout. */
      specPatch?: Partial<BinSpecInput>;
      historyLabel?: string;
    }
  | { type: "SELECT_CUTOUT"; id: string | null }
  | { type: "SELECT_FINGER_HOLE"; id: string | null }
  | { type: "SET_VIEW_MODE"; viewMode: BinViewMode }
  | { type: "SET_EDITOR_MODE"; editorMode: BinEditorMode }
  | { type: "SET_GRID"; gridX: number; gridY: number; historyLabel?: string }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "JUMP_TO_HISTORY"; index: number };

export const INITIAL_BIN_SPEC: BinSpec = parseBinSpec({
  gridX: 2,
  gridY: 2,
  heightUnits: 6,
});

const INITIAL: BinState = {
  spec: INITIAL_BIN_SPEC,
  cutouts: [],
  fingerHoles: [],
  selectedCutoutId: null,
  selectedFingerHoleId: null,
  pendingRemovalId: null,
  viewMode: "3d",
  editorMode: "placement",
  hydrated: false,
  history: {
    stack: [
      {
        doc: { spec: INITIAL_BIN_SPEC, cutouts: [], fingerHoles: [] },
        label: "Start",
      },
    ],
    index: 0,
  },
};

/** Applies a material change: new doc becomes present, redo tail is cut. */
function commit(
  state: BinState,
  doc: BinDoc,
  label: string,
  rest: Partial<BinState> = {},
): BinState {
  const stack = [
    ...state.history.stack.slice(0, state.history.index + 1),
    { doc, label },
  ];
  const overflow = Math.max(0, stack.length - HISTORY_LIMIT);
  return {
    ...state,
    ...rest,
    spec: doc.spec,
    cutouts: doc.cutouts,
    fingerHoles: doc.fingerHoles,
    history: { stack: stack.slice(overflow), index: stack.length - 1 - overflow },
  };
}

function specPatchLabel(patch: Partial<BinSpecInput>): string {
  const keys = Object.keys(patch);
  if (keys.length > 1) return "Change bin construction";
  if ("gridX" in patch) return "Change bin width";
  if ("gridY" in patch) return "Change bin depth";
  if ("heightUnits" in patch) return "Change bin height";
  if ("gridPitch" in patch) return "Change grid pitch";
  if ("lip" in patch) return "Change stacking lip";
  if ("fill" in patch) return "Change solid fill";
  if ("labelTab" in patch) return "Change label tab";
  return "Change bin construction";
}

function cutoutPatchLabel(patch: Partial<CutoutPlacement>): string {
  if ("shapeId" in patch) return "Edit contour";
  if ("position" in patch) return "Move tool pocket";
  if ("rotationDeg" in patch) return "Rotate tool pocket";
  if ("mirrored" in patch) return "Mirror tool pocket";
  if ("depth" in patch) return "Change pocket depth";
  if ("clearanceMm" in patch) return "Change pocket clearance";
  if ("cornerRoundMm" in patch) return "Change outline corner round";
  if ("topFilletMm" in patch) return "Change top edge round";
  if ("bottomFilletMm" in patch) return "Change bottom fillet";
  return "Edit tool pocket";
}

/** A transient change: present state moves, the history does not. */
function preview(state: BinState, doc: BinDoc): BinState {
  return {
    ...state,
    spec: doc.spec,
    cutouts: doc.cutouts,
    fingerHoles: doc.fingerHoles,
  };
}

function patchCutouts(
  cutouts: CutoutPlacement[],
  id: string,
  patch: Partial<CutoutPlacement>,
): CutoutPlacement[] {
  return cutouts.map((cutout) =>
    cutout.id === id ? { ...cutout, ...patch, id: cutout.id } : cutout,
  );
}

function reducer(state: BinState, action: BinAction): BinState {
  switch (action.type) {
    case "HYDRATE": {
      // A restored project is the new baseline — undo must not walk back
      // into the pre-hydration default document.
      const doc = {
        spec: action.spec,
        cutouts: action.cutouts,
        fingerHoles: action.fingerHoles ?? [],
      };
      return {
        ...state,
        spec: doc.spec,
        cutouts: doc.cutouts,
        fingerHoles: doc.fingerHoles,
        selectedCutoutId: null,
        selectedFingerHoleId: null,
        pendingRemovalId: null,
        editorMode: "placement",
        hydrated: true,
        history: {
          stack: [{ doc, label: "Project opened" }],
          index: 0,
        },
      };
    }
    case "MARK_HYDRATED":
      return state.hydrated ? state : { ...state, hydrated: true };
    case "PATCH_SPEC": {
      const changesGrid = "gridX" in action.patch || "gridY" in action.patch;
      const doc = {
        spec: parseBinSpec({
          ...state.spec,
          ...action.patch,
          ...(changesGrid && state.spec.footprint.kind === "custom" && !("footprint" in action.patch)
            ? { footprint: { kind: "rectangle" as const } }
            : {}),
        }),
        cutouts: state.cutouts,
        fingerHoles: state.fingerHoles,
      };
      return action.transient
        ? preview(state, doc)
        : commit(state, doc, action.historyLabel ?? specPatchLabel(action.patch));
    }
    case "ADD_PLACED":
      return commit(
        state,
        {
          spec: parseBinSpec({
            ...state.spec,
            gridX: action.gridX,
            gridY: action.gridY,
            ...(action.footprint ? { footprint: action.footprint } : {}),
          }),
          cutouts: [...state.cutouts, ...action.cutouts],
          fingerHoles: state.fingerHoles,
        },
        action.historyLabel ??
          `Add ${action.cutouts.length === 1 ? "tool pocket" : `${action.cutouts.length} tool pockets`}`,
        {
          selectedCutoutId: action.cutouts.at(-1)?.id ?? state.selectedCutoutId,
          selectedFingerHoleId: null,
        },
      );
    case "UPDATE_CUTOUT": {
      const doc = {
        spec: state.spec,
        cutouts: patchCutouts(state.cutouts, action.id, action.patch),
        fingerHoles: state.fingerHoles,
      };
      return action.transient
        ? preview(state, doc)
        : commit(state, doc, action.historyLabel ?? cutoutPatchLabel(action.patch));
    }
    case "ADD_FINGER_HOLE":
      return commit(
        state,
        {
          spec: state.spec,
          cutouts: state.cutouts,
          fingerHoles: [...state.fingerHoles, action.hole],
        },
        "Add finger hole",
        { selectedCutoutId: null, selectedFingerHoleId: action.hole.id },
      );
    case "UPDATE_FINGER_HOLE": {
      const doc = {
        spec: state.spec,
        cutouts: state.cutouts,
        fingerHoles: state.fingerHoles.map((hole) =>
          hole.id === action.id ? { ...hole, ...action.patch, id: hole.id } : hole,
        ),
      };
      return action.transient
        ? preview(state, doc)
        : commit(state, doc, action.historyLabel ?? "Edit finger hole");
    }
    case "REMOVE_FINGER_HOLE":
      if (!state.fingerHoles.some((hole) => hole.id === action.id)) return state;
      return commit(
        state,
        {
          spec: state.spec,
          cutouts: state.cutouts,
          fingerHoles: state.fingerHoles.filter((hole) => hole.id !== action.id),
        },
        "Remove finger hole",
        {
          selectedFingerHoleId:
            state.selectedFingerHoleId === action.id
              ? null
              : state.selectedFingerHoleId,
        },
      );
    case "REQUEST_REMOVE_CUTOUT":
      return state.cutouts.some((cutout) => cutout.id === action.id)
        ? { ...state, pendingRemovalId: action.id }
        : state;
    case "CANCEL_REMOVE_CUTOUT":
      return state.pendingRemovalId === null
        ? state
        : { ...state, pendingRemovalId: null };
    case "REMOVE_CUTOUT":
      if (!state.cutouts.some((cutout) => cutout.id === action.id)) return state;
      return commit(
        state,
        {
          spec: state.spec,
          cutouts: state.cutouts.filter((cutout) => cutout.id !== action.id),
          fingerHoles: state.fingerHoles,
        },
        "Remove tool pocket",
        {
          selectedCutoutId:
            state.selectedCutoutId === action.id ? null : state.selectedCutoutId,
          pendingRemovalId: null,
        },
      );
    case "DUPLICATE_CUTOUT": {
      const source = state.cutouts.find((cutout) => cutout.id === action.id);
      if (!source) return state;
      const copy: CutoutPlacement = {
        ...source,
        id: action.newId,
        // Offset so the twin is visibly a twin, not a mystery no-op.
        position: { x: source.position.x + 10, y: source.position.y - 10 },
      };
      return commit(
        state,
        {
          spec: state.spec,
          cutouts: [...state.cutouts, copy],
          fingerHoles: state.fingerHoles,
        },
        "Duplicate tool pocket",
        { selectedCutoutId: copy.id, selectedFingerHoleId: null },
      );
    }
    case "REPLACE_LAYOUT":
      return commit(
        state,
        {
          spec: parseBinSpec({
            ...state.spec,
            ...action.specPatch,
            gridX: action.gridX,
            gridY: action.gridY,
            ...(action.footprint ? { footprint: action.footprint } : {}),
          }),
          cutouts: action.cutouts,
          fingerHoles: action.fingerHoles ?? state.fingerHoles,
        },
        action.historyLabel ?? "Arrange tool pockets",
        {
          selectedCutoutId: action.cutouts.some(
            (cutout) => cutout.id === state.selectedCutoutId,
          )
            ? state.selectedCutoutId
            : null,
          selectedFingerHoleId: (action.fingerHoles ?? state.fingerHoles).some(
            (hole) => hole.id === state.selectedFingerHoleId,
          )
            ? state.selectedFingerHoleId
            : null,
          pendingRemovalId: null,
        },
      );
    case "SELECT_CUTOUT":
      return {
        ...state,
        selectedCutoutId: action.id,
        selectedFingerHoleId: action.id === null ? state.selectedFingerHoleId : null,
      };
    case "SELECT_FINGER_HOLE":
      return {
        ...state,
        selectedFingerHoleId: action.id,
        selectedCutoutId: action.id === null ? state.selectedCutoutId : null,
      };
    case "SET_VIEW_MODE":
      return {
        ...state,
        viewMode: action.viewMode,
        editorMode: action.viewMode === "3d" ? "placement" : state.editorMode,
      };
    case "SET_EDITOR_MODE":
      return { ...state, editorMode: action.editorMode };
    case "SET_GRID":
      return commit(
        state,
        {
          spec: parseBinSpec({
            ...state.spec,
            gridX: action.gridX,
            gridY: action.gridY,
            footprint: { kind: "rectangle" },
          }),
          cutouts: state.cutouts,
          fingerHoles: state.fingerHoles,
        },
        action.historyLabel ?? "Resize bin",
      );
    case "UNDO": {
      if (state.history.index <= 0) return state;
      const index = state.history.index - 1;
      return restore(state, state.history.stack[index], index);
    }
    case "REDO": {
      if (state.history.index >= state.history.stack.length - 1) return state;
      const index = state.history.index + 1;
      return restore(state, state.history.stack[index], index);
    }
    case "JUMP_TO_HISTORY":
      if (
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index >= state.history.stack.length ||
        action.index === state.history.index
      ) {
        return state;
      }
      return restore(state, state.history.stack[action.index], action.index);
  }
}

function restore(state: BinState, entry: BinHistoryEntry, index: number): BinState {
  const { doc } = entry;
  return {
    ...state,
    spec: doc.spec,
    cutouts: doc.cutouts,
    fingerHoles: doc.fingerHoles,
    history: { ...state.history, index },
    // Selection survives only if the cutout still exists at this point in
    // time.
    selectedCutoutId: doc.cutouts.some((c) => c.id === state.selectedCutoutId)
      ? state.selectedCutoutId
      : null,
    selectedFingerHoleId: doc.fingerHoles.some(
      (hole) => hole.id === state.selectedFingerHoleId,
    )
      ? state.selectedFingerHoleId
      : null,
    pendingRemovalId: null,
  };
}

export interface BinStore extends BinState {
  dispatch: Dispatch<BinAction>;
  canUndo: boolean;
  canRedo: boolean;
}

const BinContext = createContext<BinStore | null>(null);

export function BinProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const value = useMemo<BinStore>(
    () => ({
      ...state,
      dispatch,
      canUndo: state.history.index > 0,
      canRedo: state.history.index < state.history.stack.length - 1,
    }),
    [state],
  );
  return <BinContext.Provider value={value}>{children}</BinContext.Provider>;
}

export function useBin(): BinStore {
  const store = useContext(BinContext);
  if (!store) throw new Error("useBin must be used inside BinProvider");
  return store;
}
