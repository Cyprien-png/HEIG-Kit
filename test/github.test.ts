import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { GitHubSource, addCourseRepo, codeToMarkdown, isIndexable, parseRepoUrl, readCourseRepos, removeCourseRepo } from "../src/rag/sources/github.js";

const dir = mkdtempSync(path.join(tmpdir(), "heig-github-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("parseRepoUrl reads the usual GitHub addresses", () => {
  const plain = { owner: "heig", repo: "prg1" };
  assert.deepEqual(parseRepoUrl("https://github.com/heig/prg1"), plain);
  assert.deepEqual(parseRepoUrl("https://github.com/heig/prg1.git"), plain);
  assert.deepEqual(parseRepoUrl("git@github.com:heig/prg1.git"), plain);
  assert.deepEqual(parseRepoUrl("heig/prg1"), plain);
  assert.deepEqual(parseRepoUrl("https://github.com/heig/prg1/tree/main/cours/semaine1"), { ...plain, branch: "main", folder: "cours/semaine1" });
});

test("parseRepoUrl refuses credentials and other addresses", () => {
  assert.throws(() => parseRepoUrl("https://user:token@github.com/heig/prg1"), /credentials/);
  assert.throws(() => parseRepoUrl("https://gitlab.com/heig/prg1"), /Not a GitHub/);
  assert.throws(() => parseRepoUrl("heig"), /Not a GitHub/);
});

test("isIndexable keeps course material only", () => {
  for (const file of ["README.md", "cours/s1.pdf", "src/Main.java", "ex/a.cpp"]) assert.ok(isIndexable(file, 100), file);
  for (const file of ["CMakeLists.txt", "a/CMakeLists.txt", "logo.png", ".github/a.md", "node_modules/x/README.md", "build/a.java", "a.min.js"]) assert.ok(!isIndexable(file, 100), file);
  assert.ok(!isIndexable("big.java", 2 * 1024 * 1024));
  assert.ok(isIndexable("big.pdf", 2 * 1024 * 1024));
});

test("codeToMarkdown keeps a fence longer than those of the code", () => {
  assert.equal(codeToMarkdown("a/B.java", "class B {}\n"), "# a/B.java\n\n```java\nclass B {}\n```\n");
  assert.ok(codeToMarkdown("a.py", '"""\n```\n"""').includes("````python"));
});

test("the repository list adds, replaces and removes", async () => {
  const file = path.join(dir, "repos.json");
  await addCourseRepo("heig/prg1", "PRG", undefined, [], file);
  await addCourseRepo("https://github.com/heig/prg1", "PRG2", undefined, [], file);
  assert.deepEqual(await readCourseRepos(file), [{ owner: "heig", repo: "prg1", course: "PRG2" }]);
  await removeCourseRepo("heig/prg1", file);
  assert.deepEqual(await readCourseRepos(file), []);
  await assert.rejects(removeCourseRepo("heig/prg1", file), /not an indexed/);
});

test("GitHubSource follows the updates of a repository and reports failures", async () => {
  const origin = path.join(dir, "origin");
  mkdirSync(path.join(origin, "semaine1"), { recursive: true });
  const g = (...args: string[]) => execFileSync("git", ["-C", origin, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe" });
  g("init", "--quiet");
  writeFileSync(path.join(origin, "README.md"), "# Cours\n");
  writeFileSync(path.join(origin, "logo.png"), "x");
  writeFileSync(path.join(origin, "semaine1", "Main.java"), "class Main {}\n");
  g("add", ".");
  g("commit", "--quiet", "-m", "one");

  const repo = { owner: "heig", repo: "prg1", course: "PRG", remote: `file://${origin}` };
  const source = new GitHubSource([repo], path.join(dir, "mirrors"));
  const first = await source.list();
  assert.deepEqual(first.map((d) => d.externalId), ["heig/prg1@HEAD:README.md", "heig/prg1@HEAD:semaine1/Main.java"]);
  const java = first[1];
  assert.equal(java.courseCode, "PRG");
  assert.equal(java.chapter, "semaine1");
  assert.equal(java.filename, "Main.java.md");
  assert.equal(java.url, "https://github.com/heig/prg1/blob/HEAD/semaine1/Main.java");
  assert.equal((await java.load()).toString(), "# semaine1/Main.java\n\n```java\nclass Main {}\n```\n");

  writeFileSync(path.join(origin, "README.md"), "# Cours 2\n");
  g("rm", "--quiet", "semaine1/Main.java");
  g("add", ".");
  g("commit", "--quiet", "-m", "two");
  const second = await source.list();
  assert.deepEqual(second.map((d) => d.externalId), ["heig/prg1@HEAD:README.md"]);
  assert.notEqual(second[0].version, first[0].version);
  assert.equal((await second[0].load()).toString(), "# Cours 2\n");
  assert.deepEqual(source.failed, []);

  const without = new GitHubSource([{ ...repo, exclude: ["semaine1"] }], path.join(dir, "mirrors3"));
  writeFileSync(path.join(origin, "semaine1.md"), "# Garde\n");
  writeFileSync(path.join(origin, "compiled.cpp"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0]));
  mkdirSync(path.join(origin, "semaine1"), { recursive: true });
  writeFileSync(path.join(origin, "semaine1", "A.java"), "class A {}\n");
  g("add", ".");
  g("commit", "--quiet", "-m", "three");
  assert.deepEqual((await without.list()).map((d) => d.externalId), ["heig/prg1@HEAD:README.md", "heig/prg1@HEAD:semaine1.md"]);

  const broken = new GitHubSource([{ ...repo, remote: `file://${dir}/nothing` }], path.join(dir, "mirrors2"));
  assert.deepEqual(await broken.list(), []);
  assert.deepEqual(broken.failed, ["heig/prg1"]);
});
