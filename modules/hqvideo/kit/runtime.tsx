/** What turns the scenes of a video file and its narration into a Remotion composition. */
import React from "react";
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FPS, type VideoData, buildTimeline } from "../timeline";
import { SceneContext } from "./context";
import { Background, C, Subtitles } from "./ui";

export const WIDTH = 1920;
export const HEIGHT = 1080;

const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, dur - 10, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export interface VideoOptions {
  /** The animated dark background behind every scene (default: true). */
  background?: boolean;
}

export function makeRoot(data: VideoData, scenes: Record<string, React.FC> | undefined, options: VideoOptions = {}): React.FC {
  const timeline = buildTimeline(data);
  if (!scenes || typeof scenes !== "object") throw new Error("The video file must export its scenes: export const scenes = { intro: Intro, … }");
  for (const scene of timeline.scenes) {
    if (typeof scenes[scene.name] !== "function") throw new Error(`The narration has a scene "${scene.name}" but the video file exports no component of that name in \`scenes\``);
  }

  const Video: React.FC = () => (
    <AbsoluteFill style={{ background: C.bg0 }}>
      {timeline.scenes.map((scene) => {
        const Scene = scenes[scene.name];
        return (
          <Sequence key={scene.name} from={scene.from} durationInFrames={scene.dur} name={scene.name}>
            <SceneContext.Provider value={scene}>
              <Fade dur={scene.dur}>
                {options.background === false ? null : <Background />}
                <Scene />
                {data.subtitles ? <Subtitles /> : null}
              </Fade>
            </SceneContext.Provider>
            {data.audio
              ? scene.list
                  .filter((line) => line.file)
                  .map((line) => (
                    <Sequence key={line.id} from={line.s} durationInFrames={line.d + 15} name={line.id}>
                      <Audio src={staticFile(line.file!)} />
                    </Sequence>
                  ))
              : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );

  return () => <Composition id="Video" component={Video} durationInFrames={Math.max(1, timeline.total)} fps={FPS} width={WIDTH} height={HEIGHT} />;
}
