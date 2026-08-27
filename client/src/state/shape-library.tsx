import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import type { TracedShape } from "@shared/gridfinity/cutout";

/**
 * The app-level shape library: traced shapes on their way to (or living in)
 * the bin designer.
 *
 * App-level on purpose — wouter unmounts workspaces on navigation and both
 * the trace store and the bin store are page-local, so this context is the
 * only thing that survives the Trace → Bin hop. Shapes are **immutable by
 * id**: edits produce a new shape with a new id, which is what lets the
 * geometry worker's request key fingerprint `id:pointCount` instead of
 * hashing outlines.
 *
 * `pendingIds` marks shapes added since the bin designer last looked; the
 * designer consumes them on mount/arrival and auto-places exactly those.
 */

interface ShapeLibraryState {
  shapes: TracedShape[];
  pendingIds: string[];
}

type ShapeLibraryAction =
  | { type: "ADD_SHAPE"; shape: TracedShape }
  | { type: "STORE_SHAPE"; shape: TracedShape }
  | { type: "REMOVE_SHAPE"; id: string }
  | { type: "CONSUME_PENDING" }
  | { type: "REPLACE_SHAPES"; shapes: TracedShape[] }
  | { type: "MERGE_SHAPES"; shapes: TracedShape[] };

function reducer(state: ShapeLibraryState, action: ShapeLibraryAction): ShapeLibraryState {
  switch (action.type) {
    case "ADD_SHAPE":
      return {
        shapes: [...state.shapes.filter((s) => s.id !== action.shape.id), action.shape],
        pendingIds: [...state.pendingIds, action.shape.id],
      };
    case "STORE_SHAPE":
      // An in-place editor revision already belongs to an existing pocket.
      // Keep it in the project without sending it back through auto-placement.
      return {
        ...state,
        shapes: [...state.shapes.filter((s) => s.id !== action.shape.id), action.shape],
      };
    case "REMOVE_SHAPE":
      return {
        shapes: state.shapes.filter((s) => s.id !== action.id),
        pendingIds: state.pendingIds.filter((id) => id !== action.id),
      };
    case "CONSUME_PENDING":
      return state.pendingIds.length === 0 ? state : { ...state, pendingIds: [] };
    case "REPLACE_SHAPES":
      // Import path: replaces the collection without marking anything
      // pending — restored shapes already have placements.
      return { shapes: action.shapes, pendingIds: [] };
    case "MERGE_SHAPES": {
      // Hydration path: restored shapes join the collection *behind* any
      // shapes already present (a pending arrival from the trace workspace
      // wins on id conflict), and pending marks survive untouched.
      const existingIds = new Set(state.shapes.map((shape) => shape.id));
      const restored = action.shapes.filter((shape) => !existingIds.has(shape.id));
      return { ...state, shapes: [...restored, ...state.shapes] };
    }
  }
}

export interface ShapeLibrary {
  shapes: TracedShape[];
  pendingIds: string[];
  addShape(shape: TracedShape): void;
  /** Stores an editor revision without marking it for bin auto-placement. */
  storeShape(shape: TracedShape): void;
  removeShape(id: string): void;
  /** Returns the pending ids and clears the flag, atomically enough for UI. */
  consumePending(): string[];
  replaceShapes(shapes: TracedShape[]): void;
  /** Hydration merge: restored shapes join without disturbing pending marks. */
  mergeShapes(shapes: TracedShape[]): void;
}

const ShapeLibraryContext = createContext<ShapeLibrary | null>(null);

export function ShapeLibraryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, { shapes: [], pendingIds: [] });

  // consumePending must return the *current* ids even when called from an
  // effect that fires before the next render; a ref tracks the latest state.
  const stateRef = useRef(state);
  stateRef.current = state;

  const addShape = useCallback((shape: TracedShape) => {
    dispatch({ type: "ADD_SHAPE", shape });
  }, []);
  const storeShape = useCallback((shape: TracedShape) => {
    dispatch({ type: "STORE_SHAPE", shape });
  }, []);
  const removeShape = useCallback((id: string) => {
    dispatch({ type: "REMOVE_SHAPE", id });
  }, []);
  const consumePending = useCallback((): string[] => {
    const pending = stateRef.current.pendingIds;
    if (pending.length > 0) dispatch({ type: "CONSUME_PENDING" });
    return pending;
  }, []);
  const replaceShapes = useCallback((shapes: TracedShape[]) => {
    dispatch({ type: "REPLACE_SHAPES", shapes });
  }, []);
  const mergeShapes = useCallback((shapes: TracedShape[]) => {
    dispatch({ type: "MERGE_SHAPES", shapes });
  }, []);

  const value = useMemo<ShapeLibrary>(
    () => ({
      shapes: state.shapes,
      pendingIds: state.pendingIds,
      addShape,
      storeShape,
      removeShape,
      consumePending,
      replaceShapes,
      mergeShapes,
    }),
    [
      state,
      addShape,
      storeShape,
      removeShape,
      consumePending,
      replaceShapes,
      mergeShapes,
    ],
  );

  return (
    <ShapeLibraryContext.Provider value={value}>{children}</ShapeLibraryContext.Provider>
  );
}

export function useShapeLibrary(): ShapeLibrary {
  const library = useContext(ShapeLibraryContext);
  if (!library) {
    throw new Error("useShapeLibrary must be used inside ShapeLibraryProvider");
  }
  return library;
}
