/** Timing of the scene being drawn, given to its components by the runtime. */
import { createContext, useContext } from "react";
import type { LineTiming, SceneTiming } from "../timeline";

export const SceneContext = createContext<SceneTiming | null>(null);

/** Timing of the scene being drawn: its duration (`dur`) and its lines (`lines` by id, `list` in order). */
export function useScene(): SceneTiming {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("useScene and useLines only work inside a scene of the video");
  return scene;
}

/** The lines of the scene by id: `const { a1, a2 } = useLines()`, then `a1.s` (start frame), `a1.d` (frames), `a1.e` (end). */
export function useLines(): Record<string, LineTiming> {
  const scene = useScene();
  // A line that is not in the narration is a mistake to report by name, not an "undefined" further down.
  return new Proxy(scene.lines, {
    get(lines, id) {
      if (typeof id === "string" && !(id in lines)) throw new Error(`The scene "${scene.name}" has no line "${id}" in the narration (its lines: ${Object.keys(lines).join(", ")})`);
      return lines[id as string];
    },
  });
}
