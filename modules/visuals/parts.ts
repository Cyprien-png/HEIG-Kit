/** Splitting a scene's rendering into parallel parts, from the duration of each of its animations (plan.py). */

/** Splits consecutive animations into at most `parts` ranges [start, end) of similar total duration, none much shorter than `minSeconds`. */
export function splitAnimations(durations: number[], parts: number, minSeconds = 0): [number, number][] {
  const total = durations.reduce((a, b) => a + b, 0);
  const count = Math.max(1, Math.min(parts, durations.length, minSeconds > 0 ? Math.floor(total / minSeconds) : parts));
  const ranges: [number, number][] = [];
  let start = 0;
  let consumed = 0; // duration of the parts already made
  let elapsed = 0;
  for (let i = 0; i < durations.length && ranges.length < count - 1; i++) {
    elapsed += durations[i];
    // Each part aims at an equal share of what remains, so a long animation does not leave a tiny part after it.
    if (elapsed - consumed >= (total - consumed) / (count - ranges.length)) {
      ranges.push([start, i + 1]);
      start = i + 1;
      consumed = elapsed;
    }
  }
  ranges.push([start, durations.length]);
  return ranges.filter(([a, b]) => b > a);
}

/**
 * Times (seconds) to look at a video's layout: in each of `count` equal slices of the video, just before the end of the
 * longest animation it overlaps (usually a pause after a step, when the screen is complete), each animation once.
 */
export function keyFrameTimes(durations: number[], count: number): number[] {
  const starts: number[] = [];
  let total = 0;
  for (const d of durations) {
    starts.push(total);
    total += d;
  }
  const chosen = new Set<number>();
  for (let k = 0; k < count; k++) {
    const from = (total * k) / count;
    const to = (total * (k + 1)) / count;
    let best = -1;
    for (let i = 0; i < durations.length; i++) {
      const overlaps = starts[i] < to && starts[i] + durations[i] > from;
      if (overlaps && !chosen.has(i) && (best < 0 || durations[i] > durations[best])) best = i;
    }
    if (best >= 0) chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b).map((i) => Math.max(0, starts[i] + durations[i] - 0.1));
}
