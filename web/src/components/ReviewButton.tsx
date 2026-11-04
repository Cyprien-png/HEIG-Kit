import { ArrowPathIcon, PlayIcon } from "@heroicons/react/24/outline";
import { useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api";
import type { StudySession } from "../lib/types";
import { Button, IconButton } from "./ui";

/**
 * Starts or resumes the review of a deck (or of every due card): when a session is in progress it says so, and the
 * arrows button discards it to start again, which the student has to ask for explicitly.
 */
export function ReviewButton({ deck, disabled, count, shuffle }: { deck?: number; disabled?: boolean; count?: number; shuffle: boolean }) {
  const navigate = useNavigate();
  const current = useApi<{ session: StudySession | null }>(`/api/study/sessions${deck ? `?deck=${deck}` : ""}`, [deck]);
  const session = current.data?.session;
  const to = deck ? `/study/${deck}` : "/study";
  const inProgress = session && session.slots.length > 0;
  const restart = async () => {
    if (!session || !confirm("Abandonner la séance en cours et repartir des cartes à réviser ? Les réponses déjà données restent comptées.")) return;
    await api("/api/study/sessions", { method: "POST", json: { deck, shuffle, discard: true } });
    navigate(to);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="primary" disabled={disabled && !inProgress} onClick={() => navigate(to)}>
        <PlayIcon className="h-4 w-4" />
        {inProgress ? `Reprendre (${session.answered}/${session.slots.length})` : `Réviser${count ? ` (${count})` : ""}`}
      </Button>
      {inProgress && (
        <IconButton label="Recommencer la séance" onClick={() => void restart()}>
          <ArrowPathIcon className="h-4.5 w-4.5" />
        </IconButton>
      )}
    </span>
  );
}
