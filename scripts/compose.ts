/**
 * `docker compose` on the HEIG-Kit services (rag/compose.yml), with the NVIDIA GPU file when the machine has a GPU
 * (src/compose.ts). Used by the npm scripts: npm run rag:start, server:start…
 *   tsx scripts/compose.ts --profile server up -d --wait
 */
import { runCompose } from "../src/compose.js";

try {
  runCompose(...process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
