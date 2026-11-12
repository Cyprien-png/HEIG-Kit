import { ArrowRightStartOnRectangleIcon, CheckCircleIcon, ExclamationTriangleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { type FormEvent, type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Markdown } from "../components/Markdown";
import { Badge, Button, Card, Field, Input, PageHeader, cx } from "../components/ui";
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
      {step === "credentials" && !replace && <p className="text-sm text-ink-2">Vos identifiants edu-ID sont enregistrés (scellés avec votre mot de passe HEIG-Kit). Le serveur se reconnecte avec eux de lui-même ; ce bouton le fait tout de suite.</p>}
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

interface Terms {
  version: string;
  repository: string;
  markdown: string;
}

/** The conditions of use, as the server gives them; their links open beside the application. */
function TermsText({ onLoaded }: { onLoaded?: (terms: Terms) => void }) {
  const [terms, setTerms] = useState<Terms>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<Terms>("/api/auth/terms")
      .then((t) => {
        setTerms(t);
        onLoaded?.(t);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const outside = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link?.href) return;
    e.preventDefault();
    window.open(link.href, "_blank", "noopener,noreferrer");
  };
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!terms) return <p className="text-sm text-ink-3">Chargement…</p>;
  return (
    <div onClick={outside} className="max-h-[50vh] overflow-y-auto rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm" tabIndex={0}>
      <Markdown source={terms.markdown} />
      <p className="text-xs text-ink-3 mt-4">Version du {terms.version}</p>
    </div>
  );
}

/** The conditions to read, and the box to tick: nothing else is offered before. */
function TermsForm({ onDone }: { onDone: (me: AccountT) => void }) {
  const [terms, setTerms] = useState<Terms>();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!terms || !accepted) return;
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api<AccountT>("/api/auth/terms", { method: "POST", json: { accept: true, version: terms.version } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <TermsText onLoaded={setTerms} />
      <label className="flex items-start gap-2.5 text-sm cursor-pointer">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-accent" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} disabled={!terms} required />
        <span>J'ai lu et j'accepte les conditions d'utilisation.</span>
      </label>
      {error && <p className="text-sm text-bad">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !terms || !accepted}>
        {busy ? "Enregistrement…" : "Continuer"}
      </Button>
    </form>
  );
}

type Access = "campus" | "local";

const ACCESS_TITLE: Record<Access, string> = { campus: "Avec mon compte edu-ID", local: "Sans compte edu-ID" };

/** What each kind of access gives and what it costs, said plainly: the choice is the person's, made knowingly. */
function AccessDetails({ access }: { access: Access }) {
  const item = "flex items-start gap-2";
  if (access === "campus")
    return (
      <div className="space-y-3 text-sm text-ink-2">
        <p>
          <strong className="text-ink">Ce que vous gagnez.</strong> Votre horaire, vos notes, vos absences, votre plan d'études, vos échéances Cyberlearn et le calendrier, en plus de tout le reste.
        </p>
        <div>
          <p className="font-medium text-ink">Ce que vous confiez au serveur</p>
          <ul className="mt-1 space-y-1.5">
            <li className={item}>
              <LockClosedIcon className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
              <span>
                <strong className="text-ink">Votre mot de passe edu-ID</strong> est chiffré avec une clé tirée de votre mot de passe HEIG-Kit, qui n'est écrite nulle part. Il n'est pas lisible dans ce que le serveur enregistre, même par l'hébergeur.
              </span>
            </li>
            <li className={item}>
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>
                <strong className="text-ink">Votre session edu-ID et votre jeton Cyberlearn</strong> sont gardés pour mettre vos données à jour. Ils sont chiffrés, mais avec une clé du serveur : l'hébergeur peut techniquement les déchiffrer, et donc consulter GAPS et Cyberlearn en votre nom.
              </span>
            </li>
            <li className={item}>
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>Comme pour tout service auquel on confie un mot de passe, un serveur dont le code aurait été modifié pourrait le voir au moment où vous le saisissez.</span>
            </li>
          </ul>
        </div>
      </div>
    );
  return (
    <div className="space-y-3 text-sm text-ink-2">
      <p className={item}>
        <LockClosedIcon className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
        <span>
          <strong className="text-ink">Rien d'edu-ID n'est demandé ni enregistré</strong> : ni mot de passe, ni session, ni jeton. Le serveur ne peut rien lire sur GAPS ni sur Cyberlearn à votre nom.
        </span>
      </p>
      <p>
        <strong className="text-ink">Ce qui reste ouvert.</strong> Les supports de cours et les explications, les cartes, les quiz, la bibliothèque, les tests blancs, les anciens TE, les copies, les corrections et votre profil.
      </p>
      <p>
        <strong className="text-ink">Ce qui est fermé</strong>, dans l'application comme pour vos agents : le calendrier, l'horaire, les notes, les absences, le plan d'études et les échéances.
      </p>
    </div>
  );
}

/**
 * The two kinds of access, side by side, and the button that takes one. `current`: the one the account has (its
 * page); left out at the first login.
 */
function AccessChoice({ current, onDone }: { current?: Access | null; onDone: (me: AccountT) => void }) {
  const [picked, setPicked] = useState<Access | undefined>(current ?? undefined);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked || picked === current) return;
    if (current === "campus" && picked === "local" && !confirm("Passer en « sans compte edu-ID » ?\n\nLe serveur efface vos identifiants edu-ID, votre session, votre jeton Cyberlearn et ses copies de vos notes, absences, horaire et plan d'études. Le calendrier, l'horaire, les notes et les échéances seront fermés.")) return;
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api<AccountT>("/api/auth/access", { method: "POST", json: { access: picked } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Type d'accès">
        {(["campus", "local"] as Access[]).map((access) => (
          <label key={access} className={cx("block cursor-pointer rounded-xl border p-4 transition-colors", picked === access ? "border-accent ring-1 ring-accent bg-accent-soft/30" : "border-line hover:border-line-strong")}>
            <span className="mb-3 flex items-center gap-2.5">
              <input type="radio" name="access" className="h-4 w-4 shrink-0 accent-accent" checked={picked === access} onChange={() => setPicked(access)} />
              <span className="font-medium">{ACCESS_TITLE[access]}</span>
              {current === access && <Badge tone="accent">Actuel</Badge>}
            </span>
            <AccessDetails access={access} />
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-3">Vous pourrez changer d'avis à tout moment sur la page « Mon compte ».</p>
      {error && <p className="text-sm text-bad">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !picked || picked === current}>
        {busy ? "Enregistrement…" : !picked ? "Choisissez un type d'accès" : picked === current ? "C'est votre accès actuel" : `Continuer ${picked === "campus" ? "avec" : "sans"} edu-ID`}
      </Button>
    </form>
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
      <div className={`w-full ${me.setup === "terms" ? "max-w-2xl" : me.setup === "access" ? "max-w-3xl" : "max-w-md"} bg-surface border border-line rounded-2xl shadow-card p-6 space-y-5`}>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Bienvenue {me.firstName || me.name}</h1>
          <p className="text-sm text-ink-2 mt-1">Quelques étapes avant de commencer. Vos horaires, notes, corrections et votre profil ne sont visibles que par vous ; les supports de cours, cartes, quiz et documents sont partagés avec la classe.</p>
        </div>
        <Step n={1} title="Lire et accepter les conditions d'utilisation" state={me.setup === "terms" ? "now" : "done"}>
          <TermsForm onDone={done} />
        </Step>
        <Step n={2} title="Choisir votre mot de passe" state={me.setup === "password" ? "now" : me.setup === "terms" ? "later" : "done"}>
          <p className="text-sm text-ink-2 mb-3">Le mot de passe reçu de l'administrateur ne sert qu'une fois.</p>
          <PasswordForm first onDone={done} />
        </Step>
        <Step n={3} title="Choisir votre type d'accès" state={me.setup === "access" ? "now" : me.setup === "campus" || !me.setup ? "done" : "later"}>
          <p className="text-sm text-ink-2 mb-3">HEIG-Kit fonctionne avec ou sans votre compte edu-ID. Lisez ce que chaque choix apporte et ce qu'il implique pour votre sécurité : c'est à vous de décider.</p>
          <AccessChoice onDone={done} />
        </Step>
        {me.access !== "local" && (
        <Step n={4} title="Connecter votre compte edu-ID" state={me.setup === "campus" ? "now" : me.setup ? "later" : "done"}>
          <p className="text-sm text-ink-2 mb-3">
            Le serveur lit vos horaires et vos notes sur GAPS, vos cours sur Cyberlearn. Vos identifiants sont vérifiés tout de suite, puis scellés avec votre mot de passe HEIG-Kit : ni les autres comptes ni une copie de la base ne permettent de les lire, et le serveur ne les ouvre que pendant que vous l'utilisez.
          </p>
          <CampusForm me={me} onDone={done} />
          <button type="button" onClick={() => void api<AccountT>("/api/auth/access", { method: "POST", json: { access: "local" } }).then(done)} className="mt-3 text-xs text-ink-3 underline hover:text-ink-2">
            Finalement, continuer sans compte edu-ID
          </button>
        </Step>
        )}
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
            Type d'accès <Badge tone={me.access === "local" ? "neutral" : "accent"}>{me.access === "local" ? "Sans edu-ID" : "Avec edu-ID"}</Badge>
          </span>
        }
      >
        <p className="text-sm text-ink-2 mb-3">
          {me.access === "local"
            ? "Ce compte fonctionne sans edu-ID : le calendrier, l'horaire, les notes, les absences, le plan d'études et les échéances sont fermés, et le serveur ne garde rien de votre compte edu-ID."
            : "Ce compte est relié à votre compte edu-ID : le serveur lit votre horaire, vos notes et vos échéances, et garde pour cela une session edu-ID et un jeton Cyberlearn."}
        </p>
        <details>
          <summary className="text-sm text-accent cursor-pointer">Comparer et changer de type d'accès</summary>
          <div className="mt-3">
            <AccessChoice key={me.access ?? "none"} current={me.access} onDone={(account) => (setMe(account), setSaved("access"))} />
          </div>
        </details>
        {saved === "access" && <p className="text-sm text-ok mt-3">Type d'accès changé.</p>}
      </Card>
      {me.access !== "local" && (
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
      )}
      <Card title="Mot de passe">
        {saved === "password" && <p className="text-sm text-ok mb-3">Mot de passe changé. Vos autres appareils et applications devront se reconnecter.</p>}
        <PasswordForm onDone={(account) => (setMe(account), setSaved("password"))} />
      </Card>
      <Card title="Conditions d'utilisation">
        <details>
          <summary className="text-sm text-ink-2 cursor-pointer">Acceptées {me.terms.acceptedAt ? relative(me.terms.acceptedAt) : ""} : les relire</summary>
          <div className="mt-3">
            <TermsText />
          </div>
        </details>
      </Card>
    </div>
  );
}
