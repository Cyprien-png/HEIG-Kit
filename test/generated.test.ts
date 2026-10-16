import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listGenerated } from "../src/generated.js";

test("generated videos are found by any keyword of their scene, described by the scene's docstring", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "heig-kit-generated-"));
  const previous = process.env.HEIG_OUTPUT_DIR;
  process.env.HEIG_OUTPUT_DIR = base;
  try {
    const videos = path.join(base, "videos");
    mkdirSync(videos, { recursive: true });
    writeFileSync(
      path.join(videos, "mad-ordres.py"),
      'def hasse(nodes):\n    """Hasse diagram helper."""\n\n\nclass OrdresTotaux(Scene):\n    """MAD : ordre total ou partiel."""\n    # divisibilité sur {1, 2, 3, 6}\n',
    );
    writeFileSync(path.join(videos, "OrdresTotaux.mp4"), "");
    writeFileSync(path.join(videos, "mad-equiv.py"), 'class RelationsEquivalence(Scene):\n    """MAD : relations d\'équivalence."""\n');
    writeFileSync(path.join(videos, "RelationsEquivalence.mp4"), "");

    const [first, ...rest] = listGenerated(["ordre", "hasse"]);
    assert.equal(first.title, "MAD : ordre total ou partiel.");
    assert.equal(rest.length, 0);
    // Accents are ignored, the scene's text is searched, any keyword is enough.
    assert.deepEqual(listGenerated(["divisibilite"]).map((i) => path.basename(i.file)), ["OrdresTotaux.mp4"]);
    assert.equal(listGenerated(["equivalence", "ordre"]).length, 2);
    assert.equal(listGenerated(["integrale"]).length, 0);
  } finally {
    if (previous === undefined) delete process.env.HEIG_OUTPUT_DIR;
    else process.env.HEIG_OUTPUT_DIR = previous;
    rmSync(base, { recursive: true, force: true });
  }
});
