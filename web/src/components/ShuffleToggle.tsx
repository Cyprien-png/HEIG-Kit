import { cx } from "./ui";

/** Crossing arrows, in the stroke style of Heroicons (which has no shuffle icon). */
function ShuffleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M16.5 3.75h3.75v3.75M20.25 3.75 4.5 19.5M16.5 20.25h3.75V16.5M20.25 20.25 14.25 14.25M4.5 4.5l5.25 5.25" />
    </svg>
  );
}

/** Whether the next session goes in a random order: an icon button that stays lit while on. */
export function ShuffleToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Mélanger : activé" : "Mélanger : désactivé"}
      title={on ? "Mélanger : activé" : "Mélanger"}
      onClick={() => onChange(!on)}
      className={cx("inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors", on ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink")}
    >
      <ShuffleIcon className="h-5 w-5" />
    </button>
  );
}
