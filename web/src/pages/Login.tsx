import { type FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../lib/auth";
import { Button, Field, Input } from "../components/ui";

export function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(username.trim(), password);
      navigate(location.state?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error && /credentials/.test(err.message) ? "Identifiants refusés." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm bg-surface border border-line rounded-2xl shadow-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-lg bg-ink text-canvas grid place-items-center font-mono text-sm font-bold">HK</span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">HEIG-Kit</h1>
            <p className="text-xs text-ink-2">Le compte défini dans le .env du serveur</p>
          </div>
        </div>
        <Field label="Utilisateur">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </Field>
        <Field label="Mot de passe">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </Button>
      </form>
    </div>
  );
}
