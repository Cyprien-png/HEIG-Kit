import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Table, Td, Toggle } from "../components/ui";
import { api, useApi } from "../lib/api";
import { relative } from "../lib/format";
import type { AdminUser, RequestEntry } from "../lib/types";

const dateTime = (iso: string) => new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Zurich" }).format(new Date(iso));

const STATE: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  ready: { label: "Prêt", tone: "ok" },
  password: { label: "Mot de passe à choisir", tone: "warn" },
  campus: { label: "edu-ID à connecter", tone: "warn" },
  expired: { label: "edu-ID à reconnecter", tone: "warn" },
  disabled: { label: "Désactivé", tone: "bad" },
};
const stateOf = (u: AdminUser) => STATE[u.disabled ? "disabled" : (u.setup ?? (u.campus === "expired" ? "expired" : "ready"))];

/** What a request did, in words: the tool an agent called, or the part of the application it touched. */
function describe(e: RequestEntry): string {
  if (e.tool) return `Outil ${e.tool}`;
  if (e.path === "/mcp") return "Agent (MCP)";
  if (e.path.startsWith("/oauth/")) return "Autorisation d'une application";
  if (e.path === "/api/auth/login") return "Connexion";
  const part = e.path.replace(/^\/api\//, "").split("/")[0];
  const verb = e.method === "GET" ? "Lecture" : e.method === "DELETE" ? "Suppression" : e.method === "POST" ? "Création ou action" : "Modification";
  return `${verb} · ${part}`;
}

/** The administrators' journal: the accounts and what each one asked the server lately. */
export function Journal() {
  const { id } = useParams();
  return id ? <UserJournal userId={Number(id)} /> : <Accounts />;
}

function Accounts() {
  const users = useApi<{ users: AdminUser[] }>("/api/admin/users", [], { refreshMs: 30_000 });
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (users.data?.users ?? [])
      .filter((u) => words.every((w) => `${u.name} ${u.email}`.toLowerCase().includes(w)))
      .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || a.name.localeCompare(b.name));
  }, [users.data, q]);
  return (
    <div className="space-y-4">
      <PageHeader title="Journal" subtitle="Les comptes du serveur et leur activité. Les comptes se gèrent sur le serveur : npm run users." />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un compte par nom ou adresse…" className="max-w-md" />
      {users.error && <ErrorBox error={users.error} retry={users.reload} />}
      {users.loading && !users.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="Aucun compte ne correspond" />
      ) : (
        <Card padded={false}>
          <Table head={["Compte", "État", "Dernière activité", "24 h", "7 jours", "Refus (7 j)"]}>
            {list.map((u) => (
              <tr key={u.id} className="hover:bg-surface-2">
                <Td>
                  <Link to={`/journal/${u.id}`} className="block">
                    <span className="font-medium">{u.name}</span> {u.role === "admin" && <Badge tone="accent">admin</Badge>}
                    <span className="block text-xs text-ink-3">{u.email}</span>
                  </Link>
                </Td>
                <Td>
                  <Badge tone={stateOf(u).tone}>{stateOf(u).label}</Badge>
                </Td>
                <Td className="text-ink-2">{u.lastActivityAt ? relative(u.lastActivityAt) : "jamais"}</Td>
                <Td mono>{u.requestsDay}</Td>
                <Td mono>{u.requestsWeek}</Td>
                <Td mono className={u.refusedWeek > 0 ? "text-warn" : undefined}>{u.refusedWeek}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function UserJournal({ userId }: { userId: number }) {
  const [actions, setActions] = useState(true);
  const [older, setOlder] = useState<RequestEntry[]>([]);
  const [end, setEnd] = useState(false);
  const base = `/api/admin/activity?user=${userId}&limit=100${actions ? "&actions=1" : ""}`;
  const first = useApi<{ user?: AdminUser; entries: RequestEntry[] }>(base, [], { refreshMs: 20_000 });
  const entries = [...(first.data?.entries ?? []), ...older];
  const user = first.data?.user;
  const more = async () => {
    const last = entries.at(-1);
    if (!last) return;
    const next = await api<{ entries: RequestEntry[] }>(`${base}&before=${encodeURIComponent(last.at)}`);
    setOlder((current) => [...current, ...next.entries]);
    if (next.entries.length < 100) setEnd(true);
  };
  return (
    <div className="space-y-4">
      <Link to="/journal" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeftIcon className="h-4 w-4" /> Tous les comptes
      </Link>
      <PageHeader
        title={user?.name ?? "Compte"}
        subtitle={user ? `${user.email} · ${stateOf(user).label} · dernière connexion ${user.lastLoginAt ? relative(user.lastLoginAt) : "jamais"}` : undefined}
        actions={<Toggle checked={actions} onChange={(v) => (setActions(v), setOlder([]), setEnd(false))} label="Actions seulement" />}
      />
      {first.error && <ErrorBox error={first.error} retry={first.reload} />}
      {first.loading && !first.data ? (
        <Loading />
      ) : entries.length === 0 ? (
        <Empty title="Rien dans le journal" hint={actions ? "Aucune création, modification ou refus : désactivez « Actions seulement » pour voir aussi les lectures." : "Ce compte n'a encore rien demandé au serveur."} />
      ) : (
        <Card padded={false}>
          <Table head={["Quand", "Action", "Demande", "Réponse", "Depuis"]}>
            {entries.map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <Td mono className="whitespace-nowrap text-ink-2">{dateTime(e.at)}</Td>
                <Td>{describe(e)}</Td>
                <Td mono className="text-ink-2 break-all">
                  {e.method} {e.path}
                </Td>
                <Td>
                  <Badge tone={e.status >= 500 ? "bad" : e.status >= 400 ? "warn" : "ok"}>{e.status}</Badge>
                  {e.note && <span className="ml-2 text-xs text-ink-3">{e.note}</span>}
                </Td>
                <Td mono className="text-ink-3">{e.client}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {entries.length >= 100 && !end && (
        <Button variant="secondary" onClick={() => void more()}>
          Plus ancien
        </Button>
      )}
      <p className="text-xs text-ink-3">Le journal retient ce qui a été demandé (méthode, chemin, outil, réponse) pendant 30 jours, jamais le contenu.</p>
    </div>
  );
}
