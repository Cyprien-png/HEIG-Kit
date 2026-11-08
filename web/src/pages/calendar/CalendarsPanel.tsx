import { CheckIcon, LockClosedIcon, PencilSquareIcon, PlusIcon } from "@heroicons/react/24/outline";
import { type FormEvent, useState } from "react";
import { Button, Field, Input, Modal, Textarea, Toggle, cx } from "../../components/ui";
import { api } from "../../lib/api";
import type { Calendar } from "../../lib/types";
import { CALENDAR_COLORS } from "./shared";

interface PanelProps {
  calendars: Calendar[];
  /** Events of each calendar in the period shown. */
  counts: Map<number, number>;
  onToggle: (calendar: Calendar, visible: boolean) => void;
  onEdit: (calendar: Calendar) => void;
  onCreate: () => void;
  /** Hides all calendars but this one, or shows all again. */
  onSolo: (calendar: Calendar) => void;
}

/** The list of calendars with their visibility, as in any calendar application. */
export function CalendarsPanel({ calendars, counts, onToggle, onEdit, onCreate, onSolo }: PanelProps) {
  return (
    <div className="flex flex-col gap-1 min-h-0">
      <ul className="space-y-0.5 overflow-y-auto min-h-0">
        {calendars.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 rounded-lg px-1.5 h-9 hover:bg-surface-2">
            <button
              onClick={() => onToggle(c, !c.visible)}
              onDoubleClick={() => onSolo(c)}
              title={c.visible ? "Masquer (double-clic : afficher seul)" : "Afficher"}
              aria-pressed={c.visible}
              className="h-4.5 w-4.5 shrink-0 rounded border-2 grid place-items-center transition-colors"
              style={{ borderColor: c.color, backgroundColor: c.visible ? c.color : "transparent" }}
            >
              {c.visible && <CheckIcon className="h-3 w-3 text-white" strokeWidth={3} />}
            </button>
            <button onClick={() => onToggle(c, !c.visible)} className={cx("flex-1 min-w-0 text-left text-sm truncate", c.visible ? "text-ink" : "text-ink-3")} title={c.description}>
              {c.name}
            </button>
            <span className="text-[11px] tabular-nums text-ink-3 group-hover:hidden">{counts.get(c.id) || ""}</span>
            {c.slug && <LockClosedIcon className="h-3.5 w-3.5 text-ink-3 hidden group-hover:block" title="Calendrier intégré" />}
            <button onClick={() => onEdit(c)} aria-label={`Modifier ${c.name}`} className="hidden group-hover:grid h-7 w-7 place-items-center rounded-md text-ink-2 hover:text-ink">
              <PencilSquareIcon className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <button onClick={onCreate} className="flex items-center gap-2 rounded-lg px-1.5 h-9 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
        <PlusIcon className="h-4.5 w-4.5" /> Nouveau calendrier
      </button>
    </div>
  );
}

/** Creates or edits a calendar: name, color, description, visibility; deletes the user's own ones. */
export function CalendarEditor({ calendar, onClose, onSaved }: { calendar?: Calendar; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(calendar?.name ?? "");
  const [color, setColor] = useState(calendar?.color ?? CALENDAR_COLORS[0]);
  const [description, setDescription] = useState(calendar?.description ?? "");
  const [visible, setVisible] = useState(calendar?.visible ?? true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body = { name: name.trim(), color, description: description.trim() || null, visible };
      if (calendar) await api(`/api/calendars/${calendar.id}`, { method: "PATCH", json: body });
      else await api("/api/calendars", { method: "POST", json: { ...body, description: body.description ?? undefined } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!calendar || !confirm(`Supprimer le calendrier « ${calendar.name} » et tous ses événements ?`)) return;
    setBusy(true);
    try {
      await api(`/api/calendars/${calendar.id}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={calendar ? "Modifier le calendrier" : "Nouveau calendrier"}>
      <form onSubmit={submit} className="space-y-4">
        {calendar?.slug && <p className="text-xs text-ink-2 bg-surface-2 rounded-lg px-3 py-2">Calendrier intégré : il reçoit les événements de {calendar.slug === "schedule" ? "l'horaire GAPS" : calendar.slug === "exams" ? "vos examens" : "Cyberlearn"}. Vous pouvez le renommer, le recolorer ou le masquer, pas le supprimer.</p>}
        <Field label="Nom">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Révision MAD" autoFocus />
        </Field>
        <Field label="Couleur">
          <div className="flex flex-wrap items-center gap-2">
            {CALENDAR_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} className={cx("h-7 w-7 rounded-full grid place-items-center transition-transform", color === c && "scale-110 ring-2 ring-offset-2 ring-offset-surface ring-ink/40")} style={{ backgroundColor: c }}>
                {color === c && <CheckIcon className="h-4 w-4 text-white" strokeWidth={3} />}
              </button>
            ))}
            <label className="relative h-7 w-7 rounded-full border border-dashed border-line-strong grid place-items-center cursor-pointer text-[10px] text-ink-3" title="Autre couleur">
              +
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
          </div>
        </Field>
        <Field label="Description (optionnel)">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Plan de révision pour le TE 1 du 9 novembre" />
        </Field>
        <Toggle checked={visible} onChange={setVisible} label="Affiché dans le calendrier" />
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {calendar && !calendar.slug && (
              <Button type="button" variant="danger" onClick={remove} disabled={busy}>
                Supprimer
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
              {busy ? "Enregistrement…" : calendar ? "Enregistrer" : "Créer"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
