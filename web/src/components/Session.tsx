import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Kbd, cx } from "./ui";

export type SlotState = "ok" | "bad" | undefined;

/**
 * A full-screen session (cards, quiz): a slim bar with the way out, the progress and an optional end button, the
 * answer buttons above the card so that thumbs stay low on the screen, and the card stack filling the rest. With
 * `slots`, the bar shows the position among the cards, arrows to move between them, and a strip of what was answered.
 */
export function Session({
  back,
  progress,
  slots,
  onFinish,
  finishLabel = "Terminer",
  buttons,
  children,
}: {
  back: string;
  progress?: number;
  slots?: { states: SlotState[]; index: number; onMove: (index: number) => void };
  onFinish?: () => void;
  finishLabel?: string;
  buttons?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="h-full w-full max-w-3xl mx-auto flex flex-col pt-safe px-3 pb-safe md:px-6 md:py-4 select-none">
      <div className="h-12 flex items-center gap-2 shrink-0">
        <Link to={back} aria-label="Quitter" className="h-10 w-10 -ml-2 grid place-items-center rounded-lg text-ink-2 hover:bg-surface-2">
          <ChevronLeftIcon className="h-6 w-6" />
        </Link>
        {slots ? (
          <div className="flex-1 flex items-center justify-center gap-1 text-sm tabular-nums text-ink-2">
            <button aria-label="Carte précédente" disabled={slots.index <= 0} onClick={() => slots.onMove(slots.index - 1)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-30">
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <span className="min-w-[4.5rem] text-center">{Math.min(slots.index + 1, slots.states.length)} / {slots.states.length}</span>
            <button aria-label="Carte suivante" disabled={slots.index >= slots.states.length - 1} onClick={() => slots.onMove(slots.index + 1)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-surface-2 disabled:opacity-30">
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        ) : progress !== undefined ? (
          <div className="flex-1 h-1 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {onFinish && (
          <button onClick={onFinish} className="h-8 px-3 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-surface-2">
            {finishLabel}
          </button>
        )}
      </div>
      {slots && <SlotStrip states={slots.states} index={slots.index} onMove={slots.onMove} />}
      {buttons && <div className="grid grid-cols-2 gap-3 mt-2 shrink-0">{buttons}</div>}
      <div className="relative flex-1 min-h-0 mt-3">{children}</div>
    </div>
  );
}

/** One segment per card: green or red once answered, the current one taller; a click goes to that card. */
function SlotStrip({ states, index, onMove }: { states: SlotState[]; index: number; onMove: (index: number) => void }) {
  return (
    <div className="flex items-center gap-px h-3 shrink-0" role="list">
      {states.map((state, i) => (
        <button
          key={i}
          role="listitem"
          aria-label={`Carte ${i + 1}${state === "ok" ? ", je sais" : state === "bad" ? ", à revoir" : ""}`}
          aria-current={i === index}
          onClick={() => onMove(i)}
          className={cx("flex-1 min-w-0 rounded-sm transition-all", i === index ? "h-3" : "h-1.5", state === "ok" ? "bg-ok" : state === "bad" ? "bg-bad" : i === index ? "bg-ink-3" : "bg-surface-2")}
        />
      ))}
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

/** The frame of a card in a session, with its number in the corner and, once answered, the answer given. */
export function SessionCard({ number, accent, answered, children, className }: { number: string; accent?: boolean; answered?: SlotState; children: ReactNode; className?: string }) {
  return (
    <div className={cx("h-full bg-surface border rounded-2xl shadow-card p-5 sm:p-6 flex flex-col cursor-grab active:cursor-grabbing", accent ? "border-accent/40" : "border-line", className)}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className={cx("font-mono text-xs tabular-nums", accent ? "text-accent" : "text-ink-3")}>{number}</span>
        {answered && <span className={cx("text-[11px] font-semibold uppercase tracking-wide", answered === "ok" ? "text-ok" : "text-bad")}>{answered === "ok" ? "je sais" : "à revoir"}</span>}
      </div>
      {children}
    </div>
  );
}

/** The faded card behind the current one, when another follows but is not known yet (quiz). */
export function NextCard() {
  return <div className="absolute inset-x-3 top-2 bottom-0 rounded-2xl border border-line bg-surface-2/60" aria-hidden />;
}
