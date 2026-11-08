import { useCallback, useState } from "react";

const KEY = "heig-shuffle";

/** Whether sessions (cards, quizzes) go in a random order; remembered on this device. */
export function useShuffle(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // Private browsing: the choice lasts for the page.
    }
  }, []);
  return [on, set];
}

/** A copy of the list in a random order (Fisher-Yates). */
export function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
