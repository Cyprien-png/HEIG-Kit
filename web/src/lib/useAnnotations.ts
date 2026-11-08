import { useCallback, useReducer } from "react";
import type { Annotations, Op } from "./annotations";

interface State {
  ops: Annotations;
  past: Annotations[];
  future: Annotations[];
  /** Number of changes since the copy was opened or reloaded: what the autosave watches. */
  version: number;
}

type Action = { type: "commit"; page: number; ops: Op[] } | { type: "undo" } | { type: "redo" } | { type: "reset"; ops: Annotations } | { type: "clear"; page: number };

const HISTORY = 100;

function withPage(ops: Annotations, page: number, list: Op[]): Annotations {
  const next = { ...ops };
  if (list.length === 0) delete next[String(page)];
  else next[String(page)] = list;
  return next;
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "commit":
      return { ops: withPage(state.ops, action.page, action.ops), past: [...state.past, state.ops].slice(-HISTORY), future: [], version: state.version + 1 };
    case "clear":
      return state.ops[String(action.page)] ? { ops: withPage(state.ops, action.page, []), past: [...state.past, state.ops].slice(-HISTORY), future: [], version: state.version + 1 } : state;
    case "undo": {
      const previous = state.past.at(-1);
      return previous ? { ops: previous, past: state.past.slice(0, -1), future: [state.ops, ...state.future], version: state.version + 1 } : state;
    }
    case "redo": {
      const [next, ...rest] = state.future;
      return next ? { ops: next, past: [...state.past, state.ops], future: rest, version: state.version + 1 } : state;
    }
    case "reset":
      return { ops: action.ops, past: [], future: [], version: 0 };
  }
}

/** The annotations of a copy with an undo history (the whole copy, 100 steps). */
export function useAnnotations(initial: Annotations) {
  const [state, dispatch] = useReducer(reduce, { ops: initial, past: [], future: [], version: 0 });
  return {
    ops: state.ops,
    version: state.version,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: useCallback((page: number, ops: Op[]) => dispatch({ type: "commit", page, ops }), []),
    clearPage: useCallback((page: number) => dispatch({ type: "clear", page }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback((ops: Annotations) => dispatch({ type: "reset", ops }), []),
  };
}

export type AnnotationsApi = ReturnType<typeof useAnnotations>;
