/**
 * Lists what was already generated in the output folder (documents and videos), so that the assistant reuses it
 * before creating something new, and opens an existing file.
 *
 *   npm run generated                    everything, most recent first
 *   npm run generated -- hasse ordre     items mentioning any of these words (name, title, text), best first
 *   npm run generated -- --open <file>   open a generated file with the default application
 */
import { formatGenerated, listGenerated, openGenerated } from "../src/generated.js";

const args = process.argv.slice(2);
if (args[0] === "--open") openGenerated(args[1] ?? "");
else console.log(formatGenerated(listGenerated(args), args.length > 0));
