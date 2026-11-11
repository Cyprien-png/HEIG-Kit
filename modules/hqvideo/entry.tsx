/** Page rendered by Remotion: the scenes of the video file (`@heigkit/video`) with the timing of its narration (`@heigkit/data`). */
import type React from "react";
import { registerRoot } from "remotion";
import data from "@heigkit/data";
import * as video from "@heigkit/video";
import { type VideoOptions, makeRoot } from "./kit/runtime";

const { scenes, options } = video as { scenes?: Record<string, React.FC>; options?: VideoOptions };
let Root: React.FC;
try {
  Root = makeRoot(data, scenes, options);
} catch (error) {
  // Registered anyway, so that the renderer reports this error instead of waiting for a page that never loads.
  Root = () => {
    throw error;
  };
}
registerRoot(Root);
