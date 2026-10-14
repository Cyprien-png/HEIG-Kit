/** Ollama of `rag/compose.yml`; RAG_OLLAMA_URL overrides it (e.g. from another container). */
const OLLAMA_URL = process.env.RAG_OLLAMA_URL ?? "http://127.0.0.1:11434";
/** Multilingual (French course material), 1024 dimensions, runs on CPU. */
export const EMBEDDING_MODEL = "bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;
const BATCH_SIZE = 16;

/** Downloads the embedding model into the embedder container if needed (about 1.2 GB, once). */
export async function ensureEmbeddingModel(): Promise<void> {
  const { models } = (await (await fetch(`${OLLAMA_URL}/api/tags`)).json()) as { models: { name: string }[] };
  if (models.some((m) => m.name.split(":")[0] === EMBEDDING_MODEL)) return;
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    body: JSON.stringify({ model: EMBEDDING_MODEL, stream: false }),
  });
  if (!res.ok) throw new Error(`Could not download the embedding model: ${res.status} ${await res.text()}`);
}

/** One vector per text, in order. */
export async function embed(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.slice(i, i + BATCH_SIZE) }),
    });
    if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
    vectors.push(...((await res.json()) as { embeddings: number[][] }).embeddings);
  }
  return vectors;
}
