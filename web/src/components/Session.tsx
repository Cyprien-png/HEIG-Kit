import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Kbd, cx } from "./ui";

/**
 * A full-screen session (cards, quiz): a slim bar with the way out, the progress and an optional end button, the
 * answer buttons above the card so that thumbs stay low on the screen, and the card stack filling the rest.
 */
export function Session({ back, progress, onFinish, finishLabel = "Terminer", buttons, children }: { back: string; progress?: number; onFinish?: () => void; finishLabel?: string; buttons?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full w-full max-w-3xl mx-auto flex flex-col pt-safe px-3 pb-safe md:px-6 md:py-4 select-none">
      <div className="h-12 flex items-center gap-3 shrink-0">
        <Link to={back} aria-label="Quitter" className="h-10 w-10 -ml-2 grid place-items-center rounded-lg text-ink-2 hover:bg-surface-2">
          <ChevronLeftIcon className="h-6 w-6" />
        </Link>
        {progress !== undefined && (
          <div className="flex-1 h-1 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
          </div>
        )}
        {progress === undefined && <div className="flex-1" />}
        {onFinish && (
          <button onClick={onFinish} className="h-8 px-3 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-surface-2">
            {finishLabel}
          </button>
        )}
      </div>
      {buttons && <div className="grid grid-cols-2 gap-3 mt-2 shrink-0">{buttons}</div>}
      <div className="relative flex-1 min-h-0 mt-3">{children}</div>
    </div>
  );
}

/** One of the two answers of a session; the key hint only shows where there is a keyboard. */
export function AnswerButton({ tone, icon: Icon, label, sub, kbd, onClick, disabled }: { tone: "ok" | "bad"; icon: ComponentType<{ className?: string }>; label: string; sub?: string; kbd: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx("rounded-xl border h-12 px-3 flex items-center justify-center gap-2 hover:brightness-95 dark:hover:brightness-110 transition disabled:opacity-50", tone === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-bad/30 bg-bad-soft text-bad")}
    >
      <Icon className="h-5 w-5" />
      <span className="text-sm font-semibold">{label}</span>
      {sub && <span className="text-[11px] opacity-80 tabular-nums">{sub}</span>}
      <span className="hidden md:inline-flex"><Kbd>{kbd}</Kbd></span>
    </button>
  );
}

/** The frame of a card in a session, with its number in the corner. */
export function SessionCard({ number, accent, children, className }: { number: string; accent?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx("h-full bg-surface border rounded-2xl shadow-card p-5 sm:p-6 flex flex-col cursor-grab active:cursor-grabbing", accent ? "border-accent/40" : "border-line", className)}>
      <div className={cx("font-mono text-xs tabular-nums mb-3 shrink-0", accent ? "text-accent" : "text-ink-3")}>{number}</div>
      {children}
    </div>
  );
}

/** The faded card behind the current one, when another follows. */
export function NextCard() {
  return <div className="absolute inset-x-3 top-2 bottom-0 rounded-2xl border border-line bg-surface-2/60" aria-hidden />;
}
