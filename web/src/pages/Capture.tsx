/**
 * The capture page opened from the QR code on a phone: no account, a token limited to one correction in the URL
 * fragment. Photos come from the camera or the gallery, can be rotated, cropped, reordered and deleted, then sent.
 */
import { ArrowLeftIcon, ArrowPathIcon, ArrowRightIcon, CameraIcon, CheckIcon, PaperAirplaneIcon, PhotoIcon, ScissorsIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Loading, Spinner, cx } from "../components/ui";
import { api } from "../lib/api";

interface Meta {
  id: string;
  title: string;
  course?: string;
  topic?: string;
  notes?: string;
  state: "capture" | "received" | "corrected";
  photos: { id: number; position: number; contentType: string; bytes: number }[];
}

const MAX_SIDE = 2200;

/** Re-encodes an image at a sane size and orientation (phones send 12 MP HEIC-converted JPEGs). */
async function normalize(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions).catch(() => createImageBitmap(file));
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.88));
}

async function transform(blob: Blob, rotate: 0 | 90 | 180 | 270, crop?: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const sx = crop ? Math.round(crop.x * bitmap.width) : 0;
  const sy = crop ? Math.round(crop.y * bitmap.height) : 0;
  const sw = crop ? Math.round(crop.w * bitmap.width) : bitmap.width;
  const sh = crop ? Math.round(crop.h * bitmap.height) : bitmap.height;
  const canvas = document.createElement("canvas");
  const swap = rotate === 90 || rotate === 270;
  canvas.width = swap ? sh : sw;
  canvas.height = swap ? sw : sh;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bitmap, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9));
}

export function Capture() {
  const { id = "" } = useParams();
  const token = new URLSearchParams(location.hash.slice(1)).get("t") ?? "";
  const [meta, setMeta] = useState<Meta>();
  const [error, setError] = useState<string>();
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [uploading, setUploading] = useState(0);
  const [editing, setEditing] = useState<number>();
  const [sent, setSent] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Meta>(`/api/corrections/${id}`, { capture: token });
      setMeta(m);
      setSent(m.state !== "capture");
    } catch (e) {
      setError(e instanceof Error && /401|403/.test(e.message) ? "Ce lien a expiré ou n'est pas valable. Demandez-en un nouveau à l'agent." : e instanceof Error ? e.message : String(e));
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Photos are fetched with the token and shown as blob URLs (an <img src> cannot send the header).
  useEffect(() => {
    if (!meta) return;
    for (const p of meta.photos) {
      if (urls[p.id]) continue;
      fetch(`/api/corrections/${id}/photos/${p.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.blob())
        .then((b) => setUrls((u) => ({ ...u, [p.id]: URL.createObjectURL(b) })))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const addFiles = async (files: FileList | null) => {
    if (!files || !meta) return;
    setUploading((n) => n + files.length);
    for (const file of Array.from(files)) {
      try {
        const blob = await normalize(file);
        await api(`/api/corrections/${id}/photos`, { method: "POST", body: blob, headers: { "Content-Type": "image/jpeg" }, capture: token });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await load();
  };

  const remove = async (photoId: number) => {
    if (!confirm("Supprimer cette photo ?")) return;
    await api(`/api/corrections/${id}/photos/${photoId}`, { method: "DELETE", capture: token });
    setUrls((u) => {
      const next = { ...u };
      delete next[photoId];
      return next;
    });
    await load();
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!meta) return;
    const ids = meta.photos.map((p) => p.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setMeta({ ...meta, photos: ids.map((pid) => meta.photos.find((p) => p.id === pid)!) });
    await api(`/api/corrections/${id}/photos/order`, { method: "POST", json: { ids }, capture: token });
  };

  const saveEdited = async (photoId: number, blob: Blob) => {
    await api(`/api/corrections/${id}/photos/${photoId}`, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" }, capture: token });
    setUrls((u) => ({ ...u, [photoId]: URL.createObjectURL(blob) }));
    setEditing(undefined);
    await load();
  };

  const send = async () => {
    if (!meta || meta.photos.length === 0) return;
    if (!confirm(`Envoyer ${meta.photos.length} photo${meta.photos.length > 1 ? "s" : ""} pour correction ?`)) return;
    try {
      await api(`/api/corrections/${id}/send`, { method: "POST", capture: token });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error && !meta) return <Screen><p className="text-bad text-sm text-center px-6">{error}</p></Screen>;
  if (!meta) return <Screen><Loading /></Screen>;

  if (sent) {
    return (
      <Screen>
        <div className="text-center px-6 space-y-3">
          <span className="mx-auto h-14 w-14 rounded-full bg-ok-soft text-ok grid place-items-center"><CheckIcon className="h-7 w-7" /></span>
          <h1 className="text-lg font-semibold">Photos envoyées</h1>
          <p className="text-sm text-ink-2">{meta.photos.length} page{meta.photos.length > 1 ? "s" : ""} pour « {meta.title} ». Dites à l'agent que c'est envoyé : la correction apparaîtra dans l'application sous Corrections.</p>
          {meta.state === "capture" && <Button onClick={() => setSent(false)}>Ajouter encore des photos</Button>}
        </div>
      </Screen>
    );
  }

  const editingPhoto = editing !== undefined ? meta.photos.find((p) => p.id === editing) : undefined;

  return (
    <div className="min-h-full flex flex-col bg-canvas">
      <header className="pt-safe sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-line px-4 py-3">
        <div className="text-[11px] uppercase tracking-wide text-ink-3">Correction{meta.course ? ` · ${meta.course}` : ""}</div>
        <h1 className="font-semibold leading-tight">{meta.title}</h1>
        {meta.notes && <p className="text-xs text-ink-2 mt-1">{meta.notes}</p>}
      </header>

      <main className="flex-1 p-3 pb-40">
        {error && <p className="text-sm text-bad bg-bad-soft rounded-lg px-3 py-2 mb-3">{error}</p>}
        {meta.photos.length === 0 && uploading === 0 ? (
          <div className="text-center py-16 px-6 text-ink-2 text-sm">
            <PhotoIcon className="h-10 w-10 mx-auto text-ink-3 mb-3" />
            Photographiez chaque page de vos exercices, bien à plat et éclairée. Vous pourrez les recadrer et les réordonner avant d'envoyer.
          </div>
        ) : (
          <ol className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {meta.photos.map((p, i) => (
              <li key={p.id} className="relative rounded-xl overflow-hidden border border-line bg-surface-2 aspect-[3/4]">
                {urls[p.id] ? <img src={urls[p.id]} alt={`Page ${i + 1}`} className="h-full w-full object-cover" /> : <div className="h-full grid place-items-center"><Spinner /></div>}
                <span className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[11px] font-mono rounded px-1.5 py-0.5">{i + 1}</span>
                <div className="absolute inset-x-0 bottom-0 flex justify-between items-center bg-gradient-to-t from-black/70 to-transparent p-1.5 text-white">
                  <button aria-label="Avant" disabled={i === 0} onClick={() => void move(i, -1)} className="h-8 w-8 grid place-items-center disabled:opacity-30"><ArrowLeftIcon className="h-4 w-4" /></button>
                  <button aria-label="Modifier" onClick={() => setEditing(p.id)} className="h-8 w-8 grid place-items-center"><ScissorsIcon className="h-4 w-4" /></button>
                  <button aria-label="Supprimer" onClick={() => void remove(p.id)} className="h-8 w-8 grid place-items-center"><TrashIcon className="h-4 w-4" /></button>
                  <button aria-label="Après" disabled={i === meta.photos.length - 1} onClick={() => void move(i, 1)} className="h-8 w-8 grid place-items-center disabled:opacity-30"><ArrowRightIcon className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <li key={`up-${i}`} className="rounded-xl border border-dashed border-line-strong aspect-[3/4] grid place-items-center text-xs text-ink-2"><Spinner /></li>
            ))}
          </ol>
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-surface/95 backdrop-blur border-t border-line p-3 pb-safe space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" onClick={() => cameraInput.current?.click()}><CameraIcon className="h-5 w-5" /> Photo</Button>
          <Button size="lg" onClick={() => galleryInput.current?.click()}><PhotoIcon className="h-5 w-5" /> Galerie</Button>
        </div>
        <Button size="lg" variant="primary" className="w-full" disabled={meta.photos.length === 0 || uploading > 0} onClick={() => void send()}>
          <PaperAirplaneIcon className="h-5 w-5" /> Envoyer {meta.photos.length > 0 ? `${meta.photos.length} page${meta.photos.length > 1 ? "s" : ""}` : ""}
        </Button>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={galleryInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
      </footer>

      {editingPhoto && urls[editingPhoto.id] && <Editor src={urls[editingPhoto.id]} onCancel={() => setEditing(undefined)} onSave={(blob) => void saveEdited(editingPhoto.id, blob)} />}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full grid place-items-center bg-canvas p-6">{children}</div>;
}

/** Rotate by quarter turns and crop with a draggable frame (handles on the corners). */
function Editor({ src, onCancel, onSave }: { src: string; onCancel: () => void; onSave: (blob: Blob) => void }) {
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [crop, setCrop] = useState({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: string; startX: number; startY: number; start: typeof crop } | undefined>(undefined);

  const onDown = (handle: string) => (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: crop };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag.current || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.startX) / rect.width;
    const dy = (e.clientY - drag.current.startY) / rect.height;
    const s = drag.current.start;
    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
    let next = { ...s };
    const h = drag.current.handle;
    if (h === "move") next = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
    else {
      if (h.includes("w")) { const x = clamp(s.x + dx, 0, s.x + s.w - 0.1); next.w = s.w + (s.x - x); next.x = x; }
      if (h.includes("e")) next.w = clamp(s.w + dx, 0.1, 1 - s.x);
      if (h.includes("n")) { const y = clamp(s.y + dy, 0, s.y + s.h - 0.1); next.h = s.h + (s.y - y); next.y = y; }
      if (h.includes("s")) next.h = clamp(s.h + dy, 0.1, 1 - s.y);
    }
    setCrop(next);
  };
  const onUp = () => {
    drag.current = undefined;
  };
  const save = async () => {
    setBusy(true);
    const blob = await fetch(src).then((r) => r.blob());
    onSave(await transform(blob, rotate, crop));
  };
  const handles = ["nw", "ne", "sw", "se"];
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <header className="pt-safe flex items-center justify-between px-3 py-2 text-white">
        <button onClick={onCancel} className="h-10 w-10 grid place-items-center"><XMarkIcon className="h-6 w-6" /></button>
        <span className="text-sm font-medium">Recadrer et pivoter</span>
        <button onClick={() => setRotate(((rotate + 90) % 360) as 0 | 90 | 180 | 270)} className="h-10 w-10 grid place-items-center"><ArrowPathIcon className="h-6 w-6" /></button>
      </header>
      <div className="flex-1 grid place-items-center p-3 overflow-hidden">
        <div ref={box} className="relative max-h-full max-w-full touch-none" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <img src={src} alt="" className="max-h-[70vh] max-w-full block select-none" style={{ transform: `rotate(${rotate}deg)` }} draggable={false} />
          <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)", clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0)` }} />
          <div className="absolute border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] cursor-move" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} onPointerDown={onDown("move")}>
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
              {Array.from({ length: 9 }, (_, i) => <div key={i} className="border border-white/20" />)}
            </div>
            {handles.map((h) => (
              <div key={h} onPointerDown={onDown(h)} className={cx("absolute h-7 w-7 -m-3.5 rounded-full bg-white border-2 border-accent", h.includes("n") ? "top-0" : "bottom-0", h.includes("w") ? "left-0" : "right-0")} />
            ))}
          </div>
        </div>
      </div>
      <footer className="pb-safe p-3 grid grid-cols-2 gap-2">
        <Button size="lg" onClick={onCancel} className="bg-white/10 text-white border-white/20">Annuler</Button>
        <Button size="lg" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Enregistrement…" : "Appliquer"}</Button>
      </footer>
    </div>
  );
}
