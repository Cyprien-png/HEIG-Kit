import { XMarkIcon } from "@heroicons/react/24/outline";
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect } from "react";
import { Link } from "react-router-dom";

export const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 border-transparent",
  secondary: "bg-surface text-ink border-line hover:bg-surface-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink",
  danger: "bg-bad-soft text-bad border-transparent hover:brightness-105",
};

export function Button({ variant = "secondary", size = "md", className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-8 px-2.5 text-[13px] gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-base gap-2" };
  return (
    <button
      className={cx("inline-flex items-center justify-center rounded-lg border font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none", VARIANTS[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx("inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50", className)} {...props}>
      {children}
    </button>
  );
}

export function Card({ className, children, title, actions, padded = true, id }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; padded?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("bg-surface border border-line rounded-xl shadow-card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-2 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", className, children, style }: { tone?: Tone; className?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={style} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide leading-4 whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  const colors: Record<Tone, string> = { neutral: "bg-ink-3", accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-info" };
  return <span className={cx("inline-block h-2 w-2 rounded-full", colors[tone])} />;
}

export function Stat({ label, value, hint, tone = "neutral", to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; to?: string }) {
  const body = (
    <div className="bg-surface border border-line rounded-xl p-4 h-full hover:border-line-strong transition-colors">
      <div className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums tracking-tight", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "ok" && "text-ok", tone === "accent" && "text-accent")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-2">{hint}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 rounded-full border-2 border-line-strong border-t-accent animate-spin", className)} aria-label="Chargement" />;
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2 py-8 justify-center">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="rounded-lg border border-bad/30 bg-bad-soft text-bad text-sm px-3 py-2 flex items-center justify-between gap-3">
      <span>{error}</span>
      {retry && (
        <Button size="sm" variant="ghost" onClick={retry} className="text-bad">
          Réessayer
        </Button>
      )}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-sm text-ink-2 mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-2 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
    </label>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("rounded-md font-medium transition-colors", size === "sm" ? "px-2 h-7 text-xs" : "px-3 h-8 text-sm", o.value === value ? "bg-accent-soft text-accent" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink">
      <span className={cx("relative inline-flex h-5 w-9 items-center rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}>
        <span className={cx("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={cx("relative bg-surface border border-line rounded-t-2xl sm:rounded-2xl shadow-card w-full max-h-[92vh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <header className="sticky top-0 bg-surface/95 backdrop-blur flex items-center justify-between px-4 py-3 border-b border-line z-10">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Fermer" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </IconButton>
        </header>
        <div className="p-4 pb-safe">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto -mx-4 sm:mx-0", className)}>
      <table className="w-full text-sm min-w-[480px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3 border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="px-4 sm:px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className, mono }: { children: ReactNode; className?: string; mono?: boolean }) => <td className={cx("px-4 sm:px-3 py-2 align-top", mono && "font-mono text-[13px] tabular-nums", className)}>{children}</td>;

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-line-strong bg-surface-2 font-mono text-[11px] text-ink-2">{children}</kbd>;
}
