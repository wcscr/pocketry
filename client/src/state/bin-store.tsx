import { recordTransformOrigins, type TransformOrigins } from "@shared/gridfinity/transform-origins";
import { applyLinkedEdits, clampLinkedFingerHoles, pocketDesign, fingerDesign, type DesignObjectKind } from "@shared/gridfinity/design-links";
import { sameObject, type ObjectRef, type ObjectEdits } from "@/lib/gridfinity/object-arrangement";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

import { clampFingerHoleToBin, defaultPocketFloorThicknessMm, type CutoutPlacement, type DepthSpec, type FingerHole, type PocketSectionIndex } from "@shared/gridfinity/cutout";
import { BIN_HISTORY_LIMIT, type BinDoc, type BinHistory, type BinHistoryEntry } from "@shared/gridfinity/history";
export type { BinDoc, BinHistoryEntry } from "@shared/gridfinity/history";

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
export type BinEditorMode = "placement" | "contour" | "footprint" | "label-edge" | "split"
  | "draw-rectangle" | "draw-square" | "draw-circle";

const BIN_SIZE_KEYS = ["gridX", "gridY", "gridPitch", "heightUnits", "lip", "fillHeightPercent"] as const;

export interface BinState {
  transformOrigins: TransformOrigins;
  spec: BinSpec;
  cutouts: CutoutPlacement[];
  fingerHoles: FingerHole[];
  selection: ObjectRef[];
  editError: string | null;
  selectedCutoutId: string | null;
  selectedPocketSection: PocketSectionIndex;
  selectedFingerHoleId: string | null;
  /** Pocket awaiting the user's remove/resize decision. */
  pendingRemovalId: string | null;
  viewMode: BinViewMode;
  /** Active interaction grammar in the 2D layout view. */
  editorMode: BinEditorMode;
  /** True once persistence has had its chance to restore a project. */
  hydrated: boolean;
  history: BinHistory;
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
      /** Validated saved history, absent on legacy projects and new designs. */
      history?: BinHistory;
      transformOrigins?: TransformOrigins;
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
  | { type: "DUPLICATE_LINKED"; kind: DesignObjectKind; id: string; newId: string; linkId: string }
  | { type: "LINK_DESIGNS"; kind: DesignObjectKind; ids: string[]; sourceId: string; linkId: string; tilt: boolean }
  | { type: "UNLINK_DESIGNS"; kind: DesignObjectKind; ids: string[] }
  | { type: "SET_LINKED_TILT"; id: string; enabled: boolean }
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
  | { type: "SELECT_CUTOUT"; id: string | null; section?: PocketSectionIndex; additive?: boolean }
  | { type: "SELECT_FINGER_HOLE"; id: string | null; additive?: boolean }
  | { type: "SET_SELECTION"; selection: ObjectRef[] }
  | { type: "UPDATE_OBJECTS"; edits: ObjectEdits; historyLabel: string; transient?: boolean }
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
  transformOrigins: { pockets: [], fingerHoles: [] },
  spec: INITIAL_BIN_SPEC,
  cutouts: [],
  fingerHoles: [],
  selection: [],
  editError: null,
  selectedCutoutId: null,
  selectedPocketSection: 0,
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
  doc = limitFingerAccessForBinChange(state, doc);
  const stack = [
    ...state.history.stack.slice(0, state.history.index + 1),
    { doc, label },
  ];
  const overflow = Math.max(0, stack.length - BIN_HISTORY_LIMIT);
  return {
    ...state,
    ...rest,
    editError: null,
    ...selectionState(existingSelection(rest.selection ?? state.selection, doc)),
    spec: doc.spec,
    cutouts: doc.cutouts,
    fingerHoles: doc.fingerHoles,
    history: { stack: stack.slice(overflow), index: stack.length - 1 - overflow },
  };
}

function limitFingerAccessForBinChange(state: BinState, doc: BinDoc): BinDoc {
  const previous = getCommittedBinDoc(state).spec;
  if (!BIN_SIZE_KEYS.some(key => previous[key] !== doc.spec[key])) return doc;
  return { ...doc, fingerHoles: clampLinkedFingerHoles(doc.fingerHoles, doc.spec) };
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
  if ("fillHeightPercent" in patch) return "Change fill height";
  if ("labelTab" in patch) return "Change label tab";
  return "Change bin construction";
}

function cutoutPatchLabel(patch: Partial<CutoutPlacement>): string {
  if ("shapeId" in patch) return "Edit contour";
  if ("position" in patch || "zOffsetMm" in patch) return "Move tool pocket";
  if ("rotationDeg" in patch || "tilt" in patch) return "Rotate tool pocket";
  if ("mirrored" in patch) return "Mirror tool pocket";
  if ("scaleX" in patch || "scaleY" in patch) return "Scale tool pocket";
  if ("aspectRatioLocked" in patch) return "Change pocket aspect ratio lock";
  if ("depth" in patch) return "Change pocket depth";
  if ("clearanceMm" in patch) return "Change pocket clearance";
  if ("cornerRoundMm" in patch) return "Change outline corner round";
  if ("topFilletMm" in patch) return "Change top edge round";
  if ("bottomFilletMm" in patch) return "Change bottom fillet";
  return "Edit tool pocket";
}

/** A transient change: present state moves, the history does not. */
function preview(state: BinState, doc: BinDoc): BinState {
  doc = limitFingerAccessForBinChange(state, doc);
  return {
    ...state,
    editError: null,
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

function changeDefaultFloor(cutout: CutoutPlacement, previous: number, next: number): CutoutPlacement {
  const update = (depth: DepthSpec): DepthSpec => depth.mode === "remaining" && depth.floorThicknessMm === previous
    ? { mode: "remaining", floorThicknessMm: next } : depth;
  return { ...cutout, depth: update(cutout.depth), ...(cutout.split ? {
    split: { ...cutout.split, depths: [update(cutout.split.depths[0]), update(cutout.split.depths[1])] },
  } : {}) };
}

function selectionState(selection: ObjectRef[]): Pick<BinState, "selection" | "selectedCutoutId" | "selectedFingerHoleId"> {
  const active = selection.at(-1);
  return { selection, selectedCutoutId: active?.kind === "pocket" ? active.id : null,
    selectedFingerHoleId: active?.kind === "finger" ? active.id : null };
}
function existingSelection(selection: ObjectRef[], doc: BinDoc): ObjectRef[] {
  return selection.filter((ref, i) => selection.findIndex(r => sameObject(r, ref)) === i &&
    (ref.kind === "pocket" ? doc.cutouts : doc.fingerHoles).some(o => o.id === ref.id));
}
function linkedEditError(state: BinState): BinState {
  return { ...state, editError: "Linked copies received different design changes. Edit one copy, or make the copies independent first." };
}

function reducer(state: BinState, action: BinAction): BinState {
  const next = reduceBin(state, action);
  const origins = action.type === "HYDRATE" ? action.transformOrigins ?? { pockets: [], fingerHoles: [] } : state.transformOrigins;
  const docs = action.type === "HYDRATE" ? [...next.history.stack.map(e => e.doc), next] : [getCommittedBinDoc(next)];
  const transformOrigins = recordTransformOrigins(origins, docs);
  return next.transformOrigins === transformOrigins ? next : { ...next, transformOrigins };
}

function reduceBin(state: BinState, action: BinAction): BinState {
  switch (action.type) {
    case "HYDRATE": {
      // Replace the outgoing project's entire history. Legacy projects start
      // at one baseline; saved histories retain their undo and redo branches.
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
        selection: [],
        editError: null,
        selectedCutoutId: null,
        selectedPocketSection: 0,
        selectedFingerHoleId: null,
        pendingRemovalId: null,
        editorMode: "placement",
        hydrated: true,
        history: action.history ?? {
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
        // Resizing back during the same gesture must recover the pre-drag dimensions.
        fingerHoles: BIN_SIZE_KEYS.some(key => key in action.patch)
          ? getCommittedBinDoc(state).fingerHoles : state.fingerHoles,
      };
      if (doc.spec.flatBottom !== state.spec.flatBottom) {
        const previousFloor = defaultPocketFloorThicknessMm(state.spec);
        const nextFloor = defaultPocketFloorThicknessMm(doc.spec);
        doc.cutouts = state.cutouts.map((cutout) =>
          changeDefaultFloor(cutout, previousFloor, nextFloor),
        );
      }
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
          cutouts: [...state.cutouts, ...action.cutouts.map((cutout): CutoutPlacement =>
            state.spec.flatBottom
              ? changeDefaultFloor(cutout, defaultPocketFloorThicknessMm({ flatBottom: false }), defaultPocketFloorThicknessMm(state.spec))
              : cutout,
          )],
          fingerHoles: state.fingerHoles,
        },
        action.historyLabel ??
          `Add ${action.cutouts.length === 1 ? "tool pocket" : `${action.cutouts.length} tool pockets`}`,
        {
          selection: action.cutouts.at(-1) ? [{ kind: "pocket", id: action.cutouts.at(-1)!.id }] : state.selection,
          selectedCutoutId: action.cutouts.at(-1)?.id ?? state.selectedCutoutId,
          selectedFingerHoleId: null,
        },
      );
    case "UPDATE_CUTOUT": {
      const edits = applyLinkedEdits(state, { cutouts: patchCutouts(state.cutouts, action.id, action.patch), fingerHoles: [] });
      if (!edits) return linkedEditError(state);
      const doc = { spec: state.spec, ...edits };
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
          fingerHoles: [...state.fingerHoles, clampFingerHoleToBin(action.hole, state.spec)],
        },
        "Add finger access",
        { ...selectionState([{ kind: "finger", id: action.hole.id }]) },
      );
    case "UPDATE_FINGER_HOLE": {
      const source = state.fingerHoles.find(h => h.id === action.id);
      if (!source) return state;
      const edits = applyLinkedEdits(state, { cutouts: [], fingerHoles: [{ ...source, ...action.patch, id: source.id }] });
      if (!edits) return linkedEditError(state);
      if (["diameterMm", "lengthMm", "depthMm", "kind", "rotationDeg"].some(key => key in action.patch)) {
        edits.fingerHoles = clampLinkedFingerHoles(edits.fingerHoles, state.spec, new Set([source.id]));
      }
      const doc = { spec: state.spec, ...edits };
      return action.transient ? preview(state, doc) : commit(state, doc, action.historyLabel ?? "Edit finger access");
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
        "Remove finger access",
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
        designLink: undefined,
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
        { ...selectionState([{ kind: "pocket", id: copy.id }]) },
      );
    }
    case "LINK_DESIGNS": {
      const ids = new Set(action.ids);
      const source = action.kind === "pocket" ? state.cutouts.find(c => c.id === action.sourceId) : state.fingerHoles.find(h => h.id === action.sourceId);
      if (!source || ids.size < 2 || !ids.has(source.id)) return state;
      const designLink = { id: action.linkId, tilt: action.kind === "pocket" && action.tilt };
      const doc = action.kind === "pocket"
        ? { spec: state.spec, fingerHoles: state.fingerHoles, cutouts: state.cutouts.map(c => ids.has(c.id)
          ? { ...c, ...pocketDesign({ ...source as CutoutPlacement, designLink }), designLink } : c) }
        : { spec: state.spec, cutouts: state.cutouts, fingerHoles: clampLinkedFingerHoles(state.fingerHoles.map(h => ids.has(h.id)
          ? { ...h, ...fingerDesign(source as FingerHole), designLink } : h), state.spec, ids) };
      return commit(state, doc, `Link ${action.kind === "pocket" ? "pocket" : "thumb-access"} designs`);
    }
    case "UNLINK_DESIGNS": {
      const ids = new Set(action.ids);
      const clear = <T extends { id: string; designLink?: { id: string; tilt: boolean } }>(items: T[]) =>
        items.map(item => ids.has(item.id) ? { ...item, designLink: undefined } : item);
      return commit(state, { spec: state.spec,
        cutouts: action.kind === "pocket" ? clear(state.cutouts) : state.cutouts,
        fingerHoles: action.kind === "finger" ? clear(state.fingerHoles) : state.fingerHoles }, "Make designs independent");
    }
    case "SET_LINKED_TILT": {
      const source = state.cutouts.find(c => c.id === action.id);
      if (!source?.designLink) return state;
      return commit(state, { spec: state.spec, fingerHoles: state.fingerHoles, cutouts: state.cutouts.map(c => c.designLink?.id === source.designLink!.id
        ? { ...c, designLink: { ...source.designLink!, tilt: action.enabled }, ...(action.enabled ? { tilt: source.tilt ?? { xDeg: 0, yDeg: 0 } } : {}) } : c) }, action.enabled ? "Link pocket tilt" : "Unlink pocket tilt");
    }
    case "DUPLICATE_LINKED": {
      const source = action.kind === "pocket" ? state.cutouts.find(c => c.id === action.id) : state.fingerHoles.find(h => h.id === action.id);
      if (!source) return state;
      const designLink = source.designLink ?? { id: action.linkId, tilt: false };
      let doc: BinDoc;
      if (action.kind === "pocket") {
        const pocket = source as CutoutPlacement;
        doc = { spec: state.spec, fingerHoles: state.fingerHoles, cutouts: [
          ...state.cutouts.map(c => c.id === source.id ? { ...c, designLink } : c),
          { ...pocket, id: action.newId, designLink, position: { x: pocket.position.x + 10, y: pocket.position.y - 10 } },
        ] };
      } else {
        const hole = source as FingerHole;
        doc = { spec: state.spec, cutouts: state.cutouts, fingerHoles: [
          ...state.fingerHoles.map(h => h.id === source.id ? { ...h, designLink } : h),
          { ...hole, id: action.newId, designLink, center: { x: hole.center.x + 10, y: hole.center.y - 10 } },
        ] };
      }
      return commit(state, doc, "Duplicate linked design", selectionState([{ kind: action.kind, id: action.newId }]));
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
    case "UPDATE_OBJECTS": {
      const edits = applyLinkedEdits(state, action.edits);
      if (!edits) return linkedEditError(state);
      const doc = { spec: state.spec, ...edits };
      if (JSON.stringify(doc) === JSON.stringify(getCommittedBinDoc(state))) return preview(state, doc);
      return action.transient ? preview(state, doc) : commit(state, doc, action.historyLabel);
    }
    case "SET_SELECTION":
      return { ...state, ...selectionState(existingSelection(action.selection, state)), selectedPocketSection: 0 };
    case "SELECT_CUTOUT":
    case "SELECT_FINGER_HOLE": {
      const kind = action.type === "SELECT_CUTOUT" ? "pocket" : "finger";
      const ref: ObjectRef | null = action.id ? { kind, id: action.id } : null;
      const selection = ref ? action.additive
        ? state.selection.some(r => sameObject(r, ref)) ? state.selection.filter(r => !sameObject(r, ref)) : [...state.selection, ref]
        : [ref] : state.selection.filter(r => r.kind !== kind);
      return { ...state, ...selectionState(existingSelection(selection, state)),
        selectedPocketSection: action.type === "SELECT_CUTOUT" ? action.section ?? (action.id === state.selectedCutoutId ? state.selectedPocketSection : 0) : 0 };
    }
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
    editError: null,
    spec: doc.spec,
    cutouts: doc.cutouts,
    fingerHoles: doc.fingerHoles,
    history: { ...state.history, index },
    ...selectionState(existingSelection(state.selection, doc)),
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
  const [state, dispatch] = useReducer(reducer, INITIAL, (initial): BinState => {
    try { return { ...initial, viewMode: sessionStorage.getItem("pocketry:bin-view") === "2d" ? "2d" : "3d" }; }
    catch { return initial; }
  });
  useEffect(() => { try { sessionStorage.setItem("pocketry:bin-view", state.viewMode); } catch { /* View preference is optional. */ } }, [state.viewMode]);
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
