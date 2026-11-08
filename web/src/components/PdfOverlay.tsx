import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type CopySource, makeCopy } from "../lib/workcopies";
import { PdfReader, type PdfInfo } from "./PdfReader";
import { Button } from "./ui";

/** A PDF opened over the whole window, with the button that makes a work copy of it to fill in. */
export function PdfOverlay({ url, title, downloadUrl, copy, onClose }: { url: string; title: string; downloadUrl?: string; copy?: CopySource; onClose: () => void }) {
  const navigate = useNavigate();
  const [info, setInfo] = useState<PdfInfo>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const start = async () => {
    if (!info || !copy) return;
    setBusy(true);
    setError(undefined);
    try {
      const made = await makeCopy(copy, info.bytes, info.pages);
      navigate(`/copies/${made.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <PdfReader
      overlay
      url={url}
      title={title}
      downloadUrl={downloadUrl}
      onClose={onClose}
      onLoaded={setInfo}
      actions={
        copy && (
          <>
            {error && <span className="text-xs text-bad">{error}</span>}
            <Button size="sm" variant="primary" disabled={!info || busy} onClick={() => void start()}>
              <PencilSquareIcon className="h-4 w-4" /> {busy ? "Copie…" : "Faire une copie"}
            </Button>
          </>
        )
      }
    />
  );
}
