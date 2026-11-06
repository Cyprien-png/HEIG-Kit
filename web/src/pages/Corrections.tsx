import { CameraIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CourseChip } from "../components/CourseChip";
import { Badge, Button, Card, Dot, Empty, ErrorBox, Loading, Modal, PageHeader, Segmented, cx } from "../components/ui";
import { api, useApi } from "../lib/api";
import { dateTime, relative } from "../lib/format";
import type { CorrectedExercise, Correction } from "../lib/types";

export const STATE_LABEL = { capture: "photos attendues", received: "à corriger", corrected: "corrigée" } as const;
export const STATE_TONE = { capture: "neutral", received: "warn", corrected: "ok" } as const;

/** The credit of an exercise, 0 to 1: its points when the agent gave some, otherwise 1 for correct, 0.5 for partial. */
export function exerciseScore(e: CorrectedExercise): number {
  if (e.points && e.points.total > 0) return Math.max(0, Math.min(1, e.points.obtained / e.points.total));
  return e.verdict === "correct" ? 1 : e.verdict === "partial" ? 0.5 : 0;
}

export function verdictCounts(c: Correction) {
  const ex = c.result?.exercises ?? [];
  const score = ex.reduce((sum, e) => sum + exerciseScore(e), 0);
  return {
    total: ex.length,
    correct: ex.filter((e) => e.verdict === "correct").length,
    partial: ex.filter((e) => e.verdict === "partial").length,
    wrong: ex.filter((e) => e.verdict === "wrong" || e.verdict === "missing").length,
    /** Success, 0 to 100, with partial credit. */
    percent: ex.length ? Math.round((score / ex.length) * 100) : 0,
  };
}

/** The Swiss grade (1 to 6, to a tenth) of a corrected piece of work: by points when every exercise has some, by verdicts otherwise. */
export function swissGrade(c: Correction): number | undefined {
  const ex = c.result?.exercises ?? [];
  if (ex.length === 0) return undefined;
  const pointed = ex.every((e) => e.points && e.points.total > 0);
  const ratio = pointed ? ex.reduce((s, e) => s + Math.max(0, Math.min(e.points!.total, e.points!.obtained)), 0) / ex.reduce((s, e) => s + e.points!.total, 0) : verdictCounts(c).percent / 100;
  return Math.round((1 + 5 * Math.max(0, Math.min(1, ratio))) * 10) / 10;
}

/** Success as a share of the bar; the colour follows the score. */
export function VerdictBar({ c }: { c: Correction }) {
  const v = verdictCounts(c);
  if (v.total === 0) return null;
  const tone = v.percent >= 80 ? "bg-ok" : v.percent >= 50 ? "bg-warn" : "bg-bad";
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden bg-surface-2" title={`${v.percent} % de réussite · ${v.correct} justes, ${v.partial} partiels, ${v.wrong} faux`}>
      <div className={cx("h-full", tone)} style={{ width: `${v.percent}%` }} />
    </div>
  );
}

export function Corrections() {
  const corrections = useApi<{ corrections: Correction[] }>("/api/corrections", [], { refreshMs: 60_000 });
  const [filter, setFilter] = useState<"all" | "open" | "corrected">("all");
  const [link, setLink] = useState<{ title: string; url: string }>();
  const list = (corrections.data?.corrections ?? []).filter((c) => filter === "all" || (filter === "open" ? c.state !== "corrected" : c.state === "corrected"));

  const openLink = async (c: Correction) => {
    const { captureUrl } = await api<{ captureUrl: string }>(`/api/corrections/${c.id}/capture-link`, { method: "POST" });
    setLink({ title: c.title, url: captureUrl });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Corrections" actions={<Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "Toutes" }, { value: "open", label: "En cours" }, { value: "corrected", label: "Corrigées" }]} />} />
      {corrections.error && <ErrorBox error={corrections.error} retry={corrections.reload} />}
      {corrections.loading && !corrections.data ? <Loading /> : list.length === 0 ? <Empty title="Aucune correction" hint="Dans Claude Code : « corrige ma série 3 de MAD ». Scannez le QR code, photographiez vos pages, envoyez." /> : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((c) => {
            const v = verdictCounts(c);
            return (
              <Card key={c.id} padded={false} className="flex flex-col hover:border-line-strong transition-colors">
                <Link to={`/corrections/${c.id}`} className="p-4 flex-1 block">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Dot tone={STATE_TONE[c.state]} />
                    <CourseChip code={c.course} link={false} />
                    <Badge tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Badge>
                  </div>
                  <h2 className="font-medium mt-2 leading-snug">{c.title}</h2>
                  {c.topic && <p className="text-xs text-ink-2">{c.topic}</p>}
                  {c.state === "corrected" ? (
                    <div className="mt-3 space-y-1">
                      <VerdictBar c={c} />
                      <div className="text-xs text-ink-2 tabular-nums"><span className="font-semibold text-ink">{v.percent} %</span> · {v.correct}/{v.total} juste{v.correct > 1 ? "s" : ""}{v.partial ? ` · ${v.partial} partiel${v.partial > 1 ? "s" : ""}` : ""}</div>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-2 mt-3">{c.photos.length} photo{c.photos.length > 1 ? "s" : ""}{c.sentAt ? ` · envoyées ${relative(c.sentAt)}` : ""}</p>
                  )}
                </Link>
                <div className="flex items-center justify-between px-4 py-2 border-t border-line text-xs text-ink-3">
                  <span>{dateTime(c.createdAt)}</span>
                  {c.state !== "corrected" && (
                    <Button size="sm" variant="ghost" onClick={() => void openLink(c)}>
                      <CameraIcon className="h-4 w-4" /> Photographier
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {link && (
        <Modal open onClose={() => setLink(undefined)} title={link.title}>
          <div className="space-y-3 text-sm">
            <p className="text-ink-2">Ouvrez ce lien sur votre téléphone pour photographier vos pages (valable 6 heures) :</p>
            <a href={link.url} className="block break-all font-mono text-xs bg-surface-2 rounded-lg p-3 text-accent">{link.url}</a>
            <div className="flex gap-2">
              <Button onClick={() => void navigator.clipboard?.writeText(link.url)}>Copier</Button>
              <a href={link.url}><Button variant="primary"><QrCodeIcon className="h-4 w-4" /> Ouvrir ici</Button></a>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
