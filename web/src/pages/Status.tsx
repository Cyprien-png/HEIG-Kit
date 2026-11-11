import { ArrowPathIcon, KeyIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Dot, Empty, ErrorBox, Loading, PageHeader, Table, Td, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { dateTime, relative } from "../lib/format";
import type { RequestEntry, StatusReport, SyncRun } from "../lib/types";

const STATE_TONE = { up: "ok", down: "bad", warning: "warn", off: "neutral" } as const;
const STATE_LABEL = { up: "actif", down: "arrêté", warning: "à vérifier", off: "inactif" } as const;
const RUN_LABEL: Record<string, string> = { gaps: "GAPS (horaire, notes, plan)", cyberlearn: "Cyberlearn (cours, rendus)", "ingest-check": "Vérification Cyberlearn ↔ index", github: "GitHub (dépôts de cours)" };

export function Status() {
  const status = useApi<StatusReport>("/api/status", [], { refreshMs: 20_000 });
  const requests = useApi<{ requests: RequestEntry[] }>("/api/status/requests?limit=80", [], { refreshMs: 20_000 });
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "warn"; text: string }>();
  const s = status.data;

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    setMessage(undefined);
    try {
      await fn();
      setMessage({ tone: "ok", text: done });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessage({ tone: "bad", text: msg });
    } finally {
      setBusy(undefined);
      void status.reload();
      void requests.reload();
    }
  };
  const sync = (kind?: string) => run(kind ?? "all", () => api("/api/status/sync", { method: "POST", json: kind ? { kind } : {} }), "Synchronisation terminée.");

  return (
    <div className="space-y-5">
      <PageHeader title="Statut" subtitle={s ? `Relevé ${relative(s.at)}${s.syncing ? " · synchronisation en cours" : ""}` : "Services, connexion edu-ID, synchronisations, ingestion et dernières requêtes."} actions={<><Button onClick={() => void sync()} disabled={Boolean(busy)}><ArrowPathIcon className={cx("h-4 w-4", busy && "animate-spin")} /> Tout synchroniser</Button></>} />
      {status.error && <ErrorBox error={status.error} retry={status.reload} />}
      {message && <div className={cx("rounded-lg px-3 py-2 text-sm", message.tone === "ok" ? "bg-ok-soft text-ok" : message.tone === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad")}>{message.text}</div>}
      {!s ? <Loading /> : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Services">
              <ul className="space-y-2">
                {s.services.map((svc) => (
                  <li key={svc.id} className="flex items-start gap-3 text-sm">
                    <Dot tone={STATE_TONE[svc.state]} />
                    <div className="flex-1 -mt-0.5">
                      <div className="flex items-center gap-2"><span className="font-medium">{svc.label}</span><Badge tone={STATE_TONE[svc.state]}>{STATE_LABEL[svc.state]}</Badge></div>
                      {svc.detail && <p className="text-xs text-ink-2">{svc.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Ma connexion edu-ID" actions={<Link to="/account"><Button size="sm" variant={s.login.needsCode ? "primary" : "secondary"}><KeyIcon className="h-4 w-4" /> {s.login.needsCode ? "Reconnecter" : "Gérer"}</Button></Link>}>
              <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-sm">
                <dt className="text-ink-3">État</dt>
                <dd>{s.login.needsCode ? <Badge tone="bad">code 2FA demandé</Badge> : <Badge tone="ok">session valide</Badge>}</dd>
                <dt className="text-ink-3">Session sauvegardée</dt>
                <dd>{s.login.sessionSavedAt ? `${relative(s.login.sessionSavedAt)} (${dateTime(s.login.sessionSavedAt)})` : "aucune"}</dd>
                <dt className="text-ink-3">Jeton Cyberlearn</dt>
                <dd>{s.login.cyberlearnToken ? "présent" : "absent"}</dd>
                <dt className="text-ink-3">Dernier GAPS OK</dt>
                <dd>{s.login.lastGapsOk ? relative(s.login.lastGapsOk) : "jamais"}</dd>
                <dt className="text-ink-3">Dernier Cyberlearn OK</dt>
                <dd>{s.login.lastCyberlearnOk ? relative(s.login.lastCyberlearnOk) : "jamais"}</dd>
              </dl>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Synchronisations" padded={false}>
              <ul className="divide-y divide-line">
                {(["gaps", "cyberlearn", "ingest-check", "github"] as const).map((kind) => {
                  const run = s.syncs.find((r) => r.kind === kind);
                  return (
                    <li key={kind} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Dot tone={!run ? "neutral" : run.ok === undefined ? "warn" : run.ok ? "ok" : "bad"} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{RUN_LABEL[kind]}</div>
                        <div className="text-xs text-ink-2 truncate">{run ? `${run.ok ? "OK" : run.ok === false ? "échec" : "en cours"} · ${relative(run.finishedAt ?? run.startedAt)}${run.message ? ` · ${run.message}` : ""}${run.ok && run.stats ? ` · ${runSummary(run)}` : ""}` : "jamais exécutée"}</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void sync(kind)} disabled={Boolean(busy)}><ArrowPathIcon className={cx("h-4 w-4", busy === kind && "animate-spin")} /></Button>
                    </li>
                  );
                })}
              </ul>
              <div className="px-4 py-2 border-t border-line text-xs text-ink-3 flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(s.snapshots).map(([k, v]) => (
                  <span key={k}>{k} : changé {relative(v.fetchedAt)}</span>
                ))}
              </div>
            </Card>

            <Card title="Base de connaissances">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div><div className="text-2xl font-semibold tabular-nums">{s.ingestion.documents}</div><div className="text-[11px] uppercase tracking-wide text-ink-3">documents</div></div>
                <div><div className="text-2xl font-semibold tabular-nums">{s.ingestion.chunks}</div><div className="text-[11px] uppercase tracking-wide text-ink-3">passages</div></div>
                <div><div className="text-2xl font-semibold tabular-nums">{s.ingestion.courses}</div><div className="text-[11px] uppercase tracking-wide text-ink-3">cours</div></div>
              </div>
              <p className="text-sm text-ink-2">Dernière indexation : {s.ingestion.lastIndexedAt ? relative(s.ingestion.lastIndexedAt) : "jamais"}.</p>
              {s.ingestion.pending ? (
                s.ingestion.pending.added + s.ingestion.pending.changed + s.ingestion.pending.removed === 0 ? (
                  <p className="text-sm text-ok mt-1">Index à jour avec Cyberlearn (vérifié {relative(s.ingestion.pending.checkedAt)}).</p>
                ) : (
                  <div className="mt-2 rounded-lg bg-warn-soft text-warn px-3 py-2 text-sm">
                    <p className="font-medium">Cyberlearn a changé depuis l'indexation : {s.ingestion.pending.added} nouveau(x), {s.ingestion.pending.changed} modifié(s), {s.ingestion.pending.removed} retiré(s).</p>
                    <ul className="text-xs mt-1 list-disc pl-4">{s.ingestion.pending.examples.map((x) => <li key={x}>{x}</li>)}</ul>
                    <p className="text-xs mt-1">Sur le serveur : <code className="font-mono">npm run ingest</code> (ou attendez la mise à jour quotidienne).</p>
                  </div>
                )
              ) : (
                <p className="text-sm text-ink-3 mt-1">Pas encore vérifié face à Cyberlearn.</p>
              )}
            </Card>
          </div>

          <Card title="Requêtes (24 h)" actions={<span className="text-xs text-ink-2 tabular-nums">{s.requests.total} requêtes · {s.requests.errors} erreurs · <span className={s.requests.unauthorized > 0 ? "text-bad font-semibold" : ""}>{s.requests.unauthorized} refusées (401)</span>{s.requests.lastMcpAt && ` · dernier appel MCP ${relative(s.requests.lastMcpAt)}`}</span>} padded={false}>
            {s.requests.unauthorized > 0 && <p className="px-4 py-2 text-xs text-bad bg-bad-soft/40 border-b border-line">Des requêtes avec un jeton invalide ou expiré (dernière {relative(s.requests.lastUnauthorizedAt)}) : un client doit se reconnecter (npm run remote -- login, ou claude mcp add avec un nouveau jeton).</p>}
            {requests.loading && !requests.data ? <Loading /> : (requests.data?.requests.length ?? 0) === 0 ? <Empty title="Aucune requête enregistrée" /> : (
              <Table head={["Quand", "Client", "Méthode", "Chemin", "Outil", "Statut", "Durée"]}>
                {requests.data!.requests.map((r, i) => (
                  <tr key={i} className={cx(r.status === 401 && "bg-bad-soft/30", r.status >= 500 && "bg-warn-soft/30")}>
                    <Td mono className="whitespace-nowrap text-ink-2">{dateTime(r.at)}</Td>
                    <Td mono className="text-ink-2">{r.client}</Td>
                    <Td mono>{r.method}</Td>
                    <Td mono className="max-w-[16rem] truncate">{r.path}</Td>
                    <Td mono className="text-ink-2">{r.tool ?? ""}</Td>
                    <Td mono className={cx(r.status >= 500 ? "text-warn" : r.status >= 400 ? "text-bad" : "text-ok")}>{r.status}{r.note ? ` · ${r.note}` : ""}</Td>
                    <Td mono className="text-ink-2">{r.ms} ms</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function runSummary(run: SyncRun): string {
  const s = run.stats ?? {};
  if (run.kind === "gaps") return `${s.lessons ?? 0} leçons`;
  if (run.kind === "cyberlearn") return `${s.courses ?? 0} cours, ${s.deadlines ?? 0} rendus`;
  if (run.kind === "ingest-check") return `${s.indexed ?? 0} indexés`;
  if (run.kind === "github") {
    const parts = [`${s.repos ?? 0} dépôts`, `${s.indexed ?? 0} indexés`, `${s.unchanged ?? 0} inchangés`];
    if (Number(s.removed) > 0) parts.push(`${s.removed} retirés`);
    if (Number(s.failed) > 0) parts.push(`${s.failed} échecs`);
    if (Number(s.skipped) > 0) parts.push(`${s.skipped} en attente de l'extraction`);
    if (Array.isArray(s.unreachable) && s.unreachable.length > 0) parts.push(`injoignable : ${s.unreachable.join(", ")}`);
    return parts.join(", ");
  }
  return "";
}
