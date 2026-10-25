import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Spellchecking with cspell (https://cspell.org), the engine of VS Code's Code Spell Checker, loaded
// from the spelling component (server/components.ts). The app sends the words of a file's prose and
// gets back the misspelled parts; cspell picks dictionaries by language (English, software terms,
// LaTeX, Python, …) and reads the workspace's cspell.json, cspell.config.yaml, and the like, so
// project word lists apply. Words added from the editor go to a personal list in plugin-data.

/** The part of cspell-lib's API this uses; its package is not installed in the plugin's folder. */
interface CSpell {
  getDefaultSettings(useDefaultDictionaries?: boolean): Promise<CSpellSettings>;
  mergeSettings(base: CSpellSettings, ...settings: CSpellSettings[]): CSpellSettings;
  searchForConfig(searchFrom: string): Promise<CSpellSettings | undefined>;
  constructSettingsForText(
    settings: CSpellSettings,
    text: string | undefined,
    languageId: string | string[],
  ): CSpellSettings;
  finalizeSettings(settings: CSpellSettings): CSpellSettings;
  validateText(text: string, settings: CSpellSettings): Promise<{ offset: number; text: string }[]>;
  suggestionsForWord(
    word: string,
    options: { numSuggestions: number; languageId: string; includeTies: boolean },
    settings: CSpellSettings,
  ): Promise<{ suggestions: { word: string }[] }>;
  getLanguagesForExt(extension: string): string[];
}

type CSpellSettings = { readonly __cspellSettings?: never } & Record<string, unknown>;

export interface WordIssue {
  /** Index into the words that were checked. */
  index: number;
  /** The misspelled part: the whole word, or one part of a compound such as `usageSumary`. */
  offset: number;
  length: number;
}

/** How long a workspace's cspell configuration is reused before it is read again. */
const CONFIG_TTL_MS = 10_000;
const SUGGESTIONS = 8;

export class Spelling {
  private cspell: Promise<CSpell> | null = null;
  private defaults: Promise<CSpellSettings> | null = null;
  private personal: Promise<string[]> | null = null;
  private readonly configs = new Map<string, { at: number; settings: Promise<CSpellSettings> }>();

  /**
   * `component` gives the installed spelling component folder; `wordsFile` is the personal word
   * list, one word per line.
   */
  constructor(
    private readonly component: () => Promise<string>,
    private readonly wordsFile: string,
  ) {}

  private load(): Promise<CSpell> {
    this.cspell ??= this.component()
      .then((folder) => {
        const entry = join(folder, "node_modules", "cspell-lib", "dist", "index.js");
        // cspell-lib is an ES module; load it from the component folder.
        return import(pathToFileURL(entry).href) as Promise<CSpell>;
      })
      .catch((error: unknown) => {
        this.cspell = null;
        throw error;
      });
    return this.cspell;
  }

  private personalWords(): Promise<string[]> {
    this.personal ??= readFile(this.wordsFile, "utf8").then(
      (text) => text.split(/\r?\n/).filter((word) => word.trim() !== ""),
      () => [],
    );
    return this.personal;
  }

  async addWord(word: string): Promise<void> {
    const words = await this.personalWords();
    if (words.includes(word)) return;
    const next = [...words, word].sort((a, b) => a.localeCompare(b));
    await mkdir(dirname(this.wordsFile), { recursive: true });
    await writeFile(this.wordsFile, `${next.join("\n")}\n`);
    this.personal = Promise.resolve(next);
  }

  /** Settings for files in `directory`: cspell's defaults, the workspace's config, and our words. */
  private async settings(directory: string): Promise<CSpellSettings> {
    const cspell = await this.load();
    this.defaults ??= cspell.getDefaultSettings();
    const cached = this.configs.get(directory);
    let workspace: Promise<CSpellSettings>;
    if (cached && Date.now() - cached.at < CONFIG_TTL_MS) {
      workspace = cached.settings;
    } else {
      workspace = cspell.searchForConfig(directory).then(
        (found) => found ?? {},
        () => ({}),
      );
      this.configs.set(directory, { at: Date.now(), settings: workspace });
    }
    return cspell.mergeSettings(await this.defaults, await workspace, {
      words: await this.personalWords(),
    });
  }

  private async languageId(file: string): Promise<string> {
    const cspell = await this.load();
    const extension = extname(file).slice(1).toLowerCase();
    return cspell.getLanguagesForExt(extension)[0] ?? "plaintext";
  }

  /** The misspelled parts of `words`, which come from `file`. */
  async check(file: string, words: readonly string[]): Promise<WordIssue[]> {
    if (words.length === 0) return [];
    const cspell = await this.load();
    const settings = cspell.finalizeSettings(
      cspell.constructSettingsForText(
        await this.settings(dirname(file)),
        undefined,
        await this.languageId(file),
      ),
    );
    // One word per line, so offsets map back to words.
    const starts: number[] = [];
    let at = 0;
    for (const word of words) {
      starts.push(at);
      at += word.length + 1;
    }
    const issues = await cspell.validateText(words.join("\n"), settings);
    const found: WordIssue[] = [];
    for (const issue of issues) {
      let index = starts.length - 1;
      while (index > 0 && starts[index] > issue.offset) index -= 1;
      found.push({ index, offset: issue.offset - starts[index], length: issue.text.length });
    }
    return found;
  }

  async suggest(file: string, word: string): Promise<string[]> {
    const cspell = await this.load();
    const result = await cspell.suggestionsForWord(
      word,
      { numSuggestions: SUGGESTIONS, languageId: await this.languageId(file), includeTies: false },
      await this.settings(dirname(file)),
    );
    return result.suggestions.map((suggestion) => suggestion.word).slice(0, SUGGESTIONS);
  }
}

export function personalWordsFile(dataRoot: string): string {
  return join(dataRoot, "spelling", "words.txt");
}
