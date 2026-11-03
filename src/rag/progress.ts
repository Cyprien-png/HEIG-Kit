/**
 * Progress of an ingestion: how many documents and bytes are processed out of how many, the throughput, and an estimate
 * of the time left. The estimate weighs documents by size (extraction and embedding grow with it); a document of unknown
 * size counts as the average of the known ones.
 */
export class Progress {
  private readonly weights: number[];
  private readonly total: number;
  private readonly start: number;
  private doneItems = 0;
  private doneWeight = 0;
  private doneBytes = 0;

  constructor(
    sizes: (number | undefined)[],
    private readonly now: () => number = Date.now,
  ) {
    const known = sizes.filter((s): s is number => s !== undefined && s > 0);
    const average = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    this.weights = sizes.map((s) => (s !== undefined && s > 0 ? s : average));
    this.total = this.weights.reduce((a, b) => a + b, 0);
    this.start = now();
  }

  get items(): number {
    return this.weights.length;
  }

  /** Total size to process, in bytes (estimated for documents of unknown size). */
  get totalBytes(): number {
    return this.total;
  }

  /** Marks document `index` (in the order given to the constructor) as processed, `bytes` being its real size if known. */
  done(index: number, bytes?: number): void {
    this.doneItems++;
    this.doneWeight += this.weights[index] ?? 0;
    this.doneBytes += bytes ?? this.weights[index] ?? 0;
  }

  get elapsedMs(): number {
    return this.now() - this.start;
  }

  get processedBytes(): number {
    return this.doneBytes;
  }

  /** Milliseconds left, or undefined before the first document. */
  remainingMs(): number | undefined {
    if (this.doneItems === 0 || this.doneWeight === 0) return undefined;
    return (this.elapsedMs * (this.total - this.doneWeight)) / this.doneWeight;
  }

  /** E.g. `12/40 docs · 35.2/180 MB (20%) · 1 min 30 s elapsed · ~6 min left · 23.5 MB/min`. */
  line(): string {
    const percent = this.total > 0 ? Math.floor((100 * this.doneWeight) / this.total) : 100;
    const parts = [
      `${this.doneItems}/${this.items} docs`,
      `${formatBytes(this.doneWeight)}/${formatBytes(this.total)} (${percent}%)`,
      `${formatDuration(this.elapsedMs)} elapsed`,
    ];
    const left = this.remainingMs();
    if (left !== undefined && this.doneItems < this.items) parts.push(`~${formatDuration(left)} left`);
    const minutes = this.elapsedMs / 60_000;
    if (minutes > 0 && this.doneItems > 0) parts.push(`${formatBytes(this.doneBytes / minutes)}/min`);
    return parts.join(" · ");
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 || minutes >= 10 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}
