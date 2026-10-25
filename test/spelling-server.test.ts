import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Spelling } from "../server/spelling";
import { fakeComponent } from "./component-fixture";

let folder: string;
let workspace: string;
let spelling: Spelling;
let wordsFile: string;

/** The misspelled parts of `words`, as strings. */
async function flagged(file: string, words: string[]): Promise<string[]> {
  const issues = await spelling.check(file, words);
  return issues.map((issue) => words[issue.index].slice(issue.offset, issue.offset + issue.length));
}

beforeAll(async () => {
  folder = await fakeComponent();
  workspace = await mkdtemp(join(tmpdir(), "editor-plus-spelling-"));
  wordsFile = join(workspace, "data", "words.txt");
  spelling = new Spelling(async () => folder, wordsFile);
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("spelling with cspell", () => {
  it("flags misspelled words and accepts technical ones", async () => {
    const found = await flagged(join(workspace, "talk.typ"), [
      "singless",
      "important",
      "agentic",
      "Kubernetes",
      "tpyo",
      "don't",
    ]);
    expect(found).toEqual(["singless", "tpyo"]);
  }, 30_000);

  it("checks the parts of compound words", async () => {
    expect(await flagged(join(workspace, "main.py"), ["usageSumary", "usageSummary"])).toEqual([
      "Sumary",
    ]);
  });

  it("uses the language's dictionaries", async () => {
    // LaTeX's dictionary knows its commands; plain prose does not.
    expect(await flagged(join(workspace, "paper.tex"), ["hline"])).toEqual([]);
    expect(await flagged(join(workspace, "notes.txt"), ["hline"])).toEqual(["hline"]);
  });

  it("suggests corrections", async () => {
    const suggestions = await spelling.suggest(join(workspace, "talk.typ"), "singless");
    expect(suggestions).toContain("singles");
    expect(suggestions.length).toBeLessThanOrEqual(8);
  }, 30_000);

  it("reads the workspace's cspell.json", async () => {
    const project = join(workspace, "project");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "cspell.json"), JSON.stringify({ words: ["Flubbergast"] }));
    expect(await flagged(join(project, "doc.md"), ["Flubbergast"])).toEqual([]);
    expect(await flagged(join(workspace, "doc.md"), ["Flubbergast"])).toEqual(["Flubbergast"]);
  });

  it("adds words to the personal dictionary", async () => {
    await spelling.addWord("Zorblax");
    expect(await readFile(wordsFile, "utf8")).toBe("Zorblax\n");
    expect(await flagged(join(workspace, "doc.md"), ["Zorblax"])).toEqual([]);
  });
});
