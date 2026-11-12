import { type FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "../components/ui";
import { pendingAuthorization, useSession } from "../lib/auth";

export function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const account = await login(email.trim(), password);
      const from = location.state?.from ?? "/";
      // An application waits for its authorization: back to the server's page, unless the account must be set up first.
      const waiting = pendingAuthorization(from.includes("?") ? from.slice(from.indexOf("?")) : "");
      if (waiting && !account.setup) window.location.assign(waiting);
      else navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/credentials/.test(message) ? "Adresse ou mot de passe refusé." : /too many/.test(message) ? "Trop de tentatives : réessayez dans 15 minutes." : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm bg-surface border border-line rounded-2xl shadow-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10 rounded-lg" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">HEIG-Kit</h1>
            <p className="text-xs text-ink-2">Votre compte sur ce serveur</p>
          </div>
        </div>
        <Field label="Adresse e-mail">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required placeholder="prenom.nom@heig-vd.ch" />
        </Field>
        <Field label="Mot de passe">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </Button>
        <p className="text-xs text-ink-3">Les comptes sont créés par l'administrateur du serveur. Mot de passe oublié : demandez-lui de le réinitialiser.</p>
      </form>
    </div>
  );
}
