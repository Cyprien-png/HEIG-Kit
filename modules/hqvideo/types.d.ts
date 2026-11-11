/** Modules that only exist when a video is bundled (aliases set by render.ts): the timing of its narration. */
declare module "@heigkit/data" {
  const data: import("./timeline").VideoData;
  export default data;
}
