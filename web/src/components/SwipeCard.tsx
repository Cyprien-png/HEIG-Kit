import { type PointerEvent as ReactPointerEvent, type ReactNode, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cx } from "./ui";

const SWIPE_PX = 90;
const FLY_MS = 220;

export interface SwipeCardHandle {
  /** Sends the card off to one side as if swiped (for buttons and keys). */
  fly: (direction: -1 | 1) => void;
}

interface Props {
  children: ReactNode;
  /** Called once the card has left the screen. */
  onSwipe: (direction: -1 | 1) => void;
  onTap?: () => void;
  leftLabel: string;
  rightLabel: string;
  /** Changes when the card shown changes, so the next card starts centered. */
  resetKey: string | number;
  disabled?: boolean;
  className?: string;
}

/**
 * A card dragged left or right with a finger or the mouse, with a stamp showing what each side means; a tap (no
 * movement) calls `onTap`. Vertical gestures are left to the page so it still scrolls.
 */
export const SwipeCard = forwardRef<SwipeCardHandle, Props>(function SwipeCard({ children, onSwipe, onTap, leftLabel, rightLabel, resetKey, disabled, className }, ref) {
  const [drag, setDrag] = useState<{ dx: number; dragging: boolean; leaving?: -1 | 1 }>({ dx: 0, dragging: false });
  const pointer = useRef<{ id: number; startX: number; startY: number; moved: boolean } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setDrag({ dx: 0, dragging: false });
    return () => clearTimeout(timer.current);
  }, [resetKey]);

  const fly = (direction: -1 | 1) => {
    if (disabled || drag.leaving) return;
    setDrag({ dx: direction * Math.max(window.innerWidth, 600), dragging: false, leaving: direction });
    timer.current = setTimeout(() => onSwipe(direction), FLY_MS);
  };
  useImperativeHandle(ref, () => ({ fly }));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || drag.leaving || e.button !== 0) return;
    pointer.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (!p.moved && Math.abs(dy) > Math.abs(dx)) {
      pointer.current = undefined;
      return;
    }
    p.moved = true;
    setDrag({ dx, dragging: true });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = undefined;
    const dx = e.clientX - p.startX;
    if (!p.moved) return onTap?.();
    if (Math.abs(dx) >= SWIPE_PX) fly(dx > 0 ? 1 : -1);
    else setDrag({ dx: 0, dragging: false });
  };
  const ratio = Math.max(-1, Math.min(1, drag.dx / (SWIPE_PX * 1.5)));

  return (
    <div
      className={cx("absolute inset-0 touch-pan-y", className)}
      style={{ transform: `translateX(${drag.dx}px) rotate(${drag.dx / 24}deg)`, opacity: drag.leaving ? 0 : 1, transition: drag.dragging ? "none" : `transform ${FLY_MS}ms ease-out, opacity ${FLY_MS}ms` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        pointer.current = undefined;
        setDrag({ dx: 0, dragging: false });
      }}
    >
      {children}
      <div className="pointer-events-none absolute top-5 left-5 rounded-lg border-2 border-ok text-ok px-3 py-1 text-lg font-bold uppercase tracking-wide -rotate-12 bg-surface/80" style={{ opacity: Math.max(0, ratio) }}>{rightLabel}</div>
      <div className="pointer-events-none absolute top-5 right-5 rounded-lg border-2 border-bad text-bad px-3 py-1 text-lg font-bold uppercase tracking-wide rotate-12 bg-surface/80" style={{ opacity: Math.max(0, -ratio) }}>{leftLabel}</div>
    </div>
  );
});
