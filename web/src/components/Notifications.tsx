import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../lib/api";
import { type NotificationSettings, disablePush, enablePush, isSubscribed, pushSupport } from "../lib/push";
import { Button, cx } from "./ui";

const KINDS: { kind: keyof NotificationSettings["kinds"]; label: string; hint: string }[] = [
  { kind: "document", label: "Document ou vidéo prêt", hint: "La génération d'un document (Markdown, PDF) ou d'une vidéo que vous avez demandée est terminée." },
  { kind: "correction", label: "Correction terminée", hint: "La correction d'un exercice ou d'un test que vous avez photographié est prête." },
  { kind: "courses", label: "Cours mis à jour", hint: "De nouveaux supports de cours ont été ajoutés par un administrateur." },
];

/** A setting with its switch on the right. */
function SwitchRow({ label, hint, checked, disabled, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 py-3", disabled && "opacity-50")}>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed", checked ? "bg-accent" : "bg-line-strong")}
      >
        <span className={cx("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

/** Notifications, in the settings: on or off for this device, then one switch per kind, kept by the server for the whole account. */
export function NotificationSettingsPanel() {
  const support = pushSupport();
  const [settings, setSettings] = useState<NotificationSettings>();
  const [here, setHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  useEffect(() => {
    api<NotificationSettings>("/api/notifications").then(setSettings).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    isSubscribed().then(setHere).catch(() => setHere(false));
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  // Called straight from the tap: the permission question of the browser only shows in answer to one.
  const toggle = (on: boolean) =>
    run(async () => {
      if (!settings) return;
      const next = on ? await enablePush(settings.publicKey) : await disablePush();
      if (next) setSettings(next);
      setHere(on);
    });
  const setKind = (kind: keyof NotificationSettings["kinds"], value: boolean) =>
    run(async () => {
      if (!settings) return;
      // Shown at once, put back if the server refuses.
      setSettings({ ...settings, kinds: { ...settings.kinds, [kind]: value } });
      try {
        setSettings(await api<NotificationSettings>("/api/notifications", { method: "PUT", json: { [kind]: value } }));
      } catch (err) {
        setSettings(settings);
        throw err;
      }
    });
  const blocked = support === "ok" && typeof Notification !== "undefined" && Notification.permission === "denied";
  const elsewhere = settings ? settings.devices - (here ? 1 : 0) : 0;

  return (
    <div>
      <div className="text-xs font-medium text-ink-2 mb-1.5">Notifications</div>
      {support === "install" && (
        <p className="mb-2 flex items-start gap-2 text-sm text-ink-2">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-warn" />
          <span>
            Sur iPhone et iPad, les notifications demandent d'installer l'application : dans Safari, touchez <strong>Partager</strong> puis <strong>Sur l'écran d'accueil</strong>, ouvrez HEIG-Kit depuis son icône et revenez ici (iOS 16.4 ou plus récent).
          </span>
        </p>
      )}
      {support === "unsupported" && <p className="mb-2 text-sm text-ink-2">Ce navigateur ne sait pas recevoir de notifications.</p>}
      {blocked && <p className="mb-2 text-sm text-warn">Les notifications sont bloquées pour HEIG-Kit : autorisez-les dans les réglages de cet appareil ou de ce navigateur, puis revenez ici.</p>}
      <div className="divide-y divide-line">
        <SwitchRow
          label="Activer les notifications sur cet appareil"
          hint={elsewhere > 0 ? `Déjà activées sur ${elsewhere} autre${elsewhere > 1 ? "s" : ""} appareil${elsewhere > 1 ? "s" : ""}.` : "À activer sur chaque appareil où vous voulez les recevoir."}
          checked={here}
          disabled={busy || !settings || support !== "ok" || (blocked && !here)}
          onChange={(on) => void toggle(on)}
        />
        <div className="pl-3">
          {KINDS.map(({ kind, label, hint }) => (
            <SwitchRow key={kind} label={label} hint={hint} checked={settings?.kinds[kind] ?? true} disabled={busy || !settings} onChange={(value) => void setKind(kind, value)} />
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">Le choix des types vaut pour tous vos appareils. Le contenu d'une notification est chiffré pour votre appareil : le service d'Apple, de Google ou de Mozilla qui l'achemine ne peut pas le lire.</p>
      {here && (
        <Button
          size="sm"
          className="mt-3"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { sent } = await api<{ sent: number }>("/api/notifications/test", { method: "POST" });
              setNote(sent > 0 ? "Notification d'essai envoyée." : "Aucun appareil n'a pu être joint : désactivez puis réactivez les notifications.");
            })
          }
        >
          Envoyer une notification d'essai
        </Button>
      )}
      {note && <p className="mt-2 text-sm text-ok">{note}</p>}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
