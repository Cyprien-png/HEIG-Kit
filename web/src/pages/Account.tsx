import { ArrowRightStartOnRectangleIcon, CheckCircleIcon, ExclamationTriangleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { type FormEvent, type ReactNode, useState } from "react";
import { useLocation } from "react-router-dom";
import { Badge, Button, Card, Field, Input, PageHeader } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { pendingAuthorization, useSession } from "../lib/auth";
import { relative } from "../lib/format";
import type { Account as AccountT } from "../lib/types";

const MIN_LENGTH = 12;

/**
 * Replaces the password. Right after the login that requires it the server asks for nothing else; later it asks for
 * the current password (`needs: "current"`).
 */
export function PasswordForm({ first, onDone }: { first?: boolean; onDone: (me: AccountT) => void }) {
  const [current, setCurrent] = useState("");
  const [askCurrent, setAskCurrent] = useState(!first);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError("Les deux mots de passe ne sont pas identiques.");
    if (password.length < MIN_LENGTH) return setError(`Le mot de passe doit avoir au moins ${MIN_LENGTH} caractères.`);
    setBusy(true);
    setError(undefined);
    try {
      const me = await api<AccountT>("/api/auth/password", { method: "POST", json: { password, current: askCurrent ? current : undefined } });
      setPassword("");
      setAgain("");
      setCurrent("");
      onDone(me);
    } catch (err) {
      if (err instanceof ApiError && err.data.needs === "current") setAskCurrent(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {askCurrent && (
        <Field label={first ? "Mot de passe reçu de l'administrateur" : "Mot de passe actuel"}>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </Field>
      )}
      <Field label="Nouveau mot de passe" hint={`Au moins ${MIN_LENGTH} caractères. Une phrase que vous seul connaissez convient très bien.`}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={MIN_LENGTH} required autoFocus={first} />
      </Field>
      <Field label="Encore une fois">
        <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
      </Field>
      {error && <p className="text-sm text-bad">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </Button>
    </form>
  );
}

type CampusStep = "credentials" | "code" | "account_password";

/**
 * Connects the account to edu-ID. The server tries the login on GAPS at once and says what it still needs: the edu-ID
 * credentials, the two-step code of the authenticator app, or the HEIG-Kit password that unlocks the stored
 * credentials. Nothing is stored before GAPS accepted the login.
 */
export function CampusForm({ me, onDone }: { me: AccountT; onDone: (me: AccountT) => void }) {
  // Stored credentials only need to be unlocked (or just tried again, while the server still holds their key).
  const [step, setStep] = useState<CampusStep>(me.campus.stored ? (me.campus.unlocked ? "credentials" : "account_password") : "credentials");
  const [replace, setReplace] = useState(!me.campus.stored);
  const [email, setEmail] = useState(me.email);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const send = async (body: Record<string, string | undefined>) => {
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api<AccountT>("/api/auth/campus", { method: "POST", json: body }));
    } catch (err) {
      const needs = err instanceof ApiError ? err.data.needs : undefined;
      if (needs === "code") {
        setStep("code");
        setCode("");
      } else if (needs === "account_password") setStep("account_password");
      else if (needs === "credentials") {
        setStep("credentials");
        setReplace(true);
      }
      // Asking for the code the first time is not an error.
      setError(needs === "code" && step !== "code" ? undefined : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step === "code") return void send({ mfa_code: code.replace(/\s+/g, "") });
    if (step === "account_password") return void send({ account_password: accountPassword });
    void send(replace ? { email: email.trim(), password } : {});
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {step === "credentials" && replace && (
        <>
          <Field label="Adresse edu-ID" hint="Celle avec laquelle vous vous connectez à GAPS et à Cyberlearn.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
          </Field>
          <Field label="Mot de passe edu-ID">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required autoFocus />
          </Field>
        </>
      )}
      {step === "credentials" && !replace && <p className="text-sm text-ink-2">Vos identifiants edu-ID sont enregistrés (scellés avec votre mot de passe HEIG-Kit). Le serveur va se reconnecter avec eux.</p>}
      {step === "code" && (
        <Field label="Code à 6 chiffres" hint="edu-ID demande le code actuel de votre application d'authentification.">
          <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required autoFocus className="text-center text-lg tracking-[0.3em] tabular-nums" />
        </Field>
      )}
      {step === "account_password" && (
        <Field label="Votre mot de passe HEIG-Kit" hint="Il déverrouille vos identifiants edu-ID, que le serveur ne peut pas lire sans lui.">
          <Input type="password" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} autoComplete="current-password" required autoFocus />
        </Field>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Connexion à GAPS…" : step === "code" ? "Valider le code" : step === "account_password" ? "Déverrouiller et reconnecter" : replace ? "Connecter edu-ID" : "Reconnecter"}
      </Button>
      {step !== "credentials" || !replace ? (
        <button type="button" className="text-xs text-ink-3 hover:text-ink-2 underline" onClick={() => (setStep("credentials"), setReplace(true), setError(undefined))}>
          Saisir d'autres identifiants edu-ID
        </button>
      ) : null}
    </form>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "now" | "later"; children?: ReactNode }) {
  return (
    <div className={state === "later" ? "opacity-50" : undefined}>
      <div className="flex items-center gap-2.5">
        {state === "done" ? <CheckCircleIcon className="h-6 w-6 text-ok shrink-0" /> : <span className="h-6 w-6 shrink-0 grid place-items-center rounded-full border border-line-strong text-xs font-semibold">{n}</span>}
        <h2 className="font-medium">{title}</h2>
      </div>
      {state === "now" && <div className="mt-3 pl-8.5">{children}</div>}
    </div>
  );
}

/**
 * Shown instead of the application until the account is ready: the first password must be replaced, then edu-ID
 * connected and accepted by GAPS. There is no way around it; the server refuses everything else meanwhile.
 */
export function Setup({ me }: { me: AccountT }) {
  const { setMe, logout } = useSession();
  const location = useLocation();
  const done = (account: AccountT) => {
    setMe(account);
    // An application was waiting for its authorization while the account was being set up.
    const waiting = pendingAuthorization(location.search);
    if (!account.setup && waiting) window.location.assign(waiting);
  };
  return (
    <div className="min-h-full grid place-items-center px-4 py-10">
      <div className="w-full max-w-md bg-surface border border-line rounded-2xl shadow-card p-6 space-y-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Bienvenue {me.firstName || me.name}</h1>
          <p className="text-sm text-ink-2 mt-1">Deux étapes avant de commencer. Vos horaires, notes, corrections et votre profil ne sont visibles que par vous ; les supports de cours, cartes, quiz et documents sont partagés avec la classe.</p>
        </div>
        <Step n={1} title="Choisir votre mot de passe" state={me.setup === "password" ? "now" : "done"}>
          <p className="text-sm text-ink-2 mb-3">Le mot de passe reçu de l'administrateur ne sert qu'une fois.</p>
          <PasswordForm first onDone={done} />
        </Step>
        <Step n={2} title="Connecter votre compte edu-ID" state={me.setup === "campus" ? "now" : me.setup === "password" ? "later" : "done"}>
          <p className="text-sm text-ink-2 mb-3">
            Le serveur lit vos horaires et vos notes sur GAPS, vos cours sur Cyberlearn. Vos identifiants sont vérifiés tout de suite, puis scellés avec votre mot de passe HEIG-Kit : personne d'autre ne peut les lire, pas même l'administrateur.
          </p>
          <CampusForm me={me} onDone={done} />
        </Step>
        <button onClick={() => void logout()} className="flex items-center gap-2 text-xs text-ink-3 hover:text-ink-2">
          <ArrowRightStartOnRectangleIcon className="h-4 w-4" /> Se déconnecter ({me.email})
        </button>
      </div>
    </div>
  );
}

/** The account's own page: who it is, its edu-ID connection, its password. */
export function Account() {
  const { me, setMe } = useSession();
  const [saved, setSaved] = useState<string>();
  if (!me) return null;
  const expired = me.campus.state !== "ok";
  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader title="Mon compte" subtitle={me.email} />
      <Card title="Identité">
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="font-medium">{me.name}</span>
          <Badge tone={me.role === "admin" ? "accent" : "neutral"}>{me.role === "admin" ? "Administrateur" : "Étudiant"}</Badge>
        </div>
        <p className="text-xs text-ink-3 mt-2">Le nom, l'adresse et le rôle sont gérés par l'administrateur du serveur.</p>
      </Card>
      <Card
        title={
          <span className="flex items-center gap-2">
            Connexion edu-ID {expired ? <Badge tone="warn">À reconnecter</Badge> : <Badge tone="ok">Active</Badge>}
          </span>
        }
      >
        {expired ? (
          <p className="text-sm text-warn flex items-start gap-2 mb-3">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" /> La session edu-ID du serveur a pris fin : vos horaires, notes et échéances ne se mettent plus à jour.
          </p>
        ) : (
          <p className="text-sm text-ink-2 mb-3 flex items-start gap-2">
            <LockClosedIcon className="h-5 w-5 shrink-0 text-ink-3" /> Validée sur GAPS {me.campus.verifiedAt ? relative(me.campus.verifiedAt) : ""}. Vos identifiants sont scellés avec votre mot de passe HEIG-Kit.
          </p>
        )}
        {saved === "campus" && <p className="text-sm text-ok mb-3">Reconnecté : GAPS a accepté la connexion.</p>}
        <CampusForm key={`${me.campus.state}-${me.campus.unlocked}`} me={me} onDone={(account) => (setMe(account), setSaved("campus"))} />
      </Card>
      <Card title="Mot de passe">
        {saved === "password" && <p className="text-sm text-ok mb-3">Mot de passe changé. Vos autres appareils et applications devront se reconnecter.</p>}
        <PasswordForm onDone={(account) => (setMe(account), setSaved("password"))} />
      </Card>
    </div>
  );
}
