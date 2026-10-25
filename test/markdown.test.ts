import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMarp, renderMarkdown } from "../server/markdown";

describe("Markdown preview rendering", () => {
  it("marks blocks with their source lines and keeps raw HTML out", async () => {
    const { kind, html } = await renderMarkdown(
      "/w/a.md",
      "# Title\n\nText <script>x()</script>\n\n```js\nconst a = 1;\n```\n",
    );
    expect(kind).toBe("markdown");
    expect(html).toContain('<h1 data-source-line="0">Title</h1>');
    expect(html).toContain('data-source-line="2"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("hljs-keyword");
  });

  it("detects Marp decks from front matter and renders slides without scripts", async () => {
    expect(isMarp("---\nmarp: true\n---\n# A")).toBe(true);
    expect(isMarp("---\ntitle: x\n---\n# A")).toBe(false);
    expect(isMarp("# marp: true")).toBe(false);
    const { kind, html, css } = await renderMarkdown(
      "/w/deck.md",
      "---\nmarp: true\n---\n# One\n\n---\n\n# Two\n",
    );
    expect(kind).toBe("marp");
    expect((html.match(/<section/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/<script/);
    expect(css.length).toBeGreaterThan(1000);
    // Zero-based: the second slide starts at its separator (line 5), its heading on line 7.
    expect(html).toMatch(/<section id="2" data-source-line="5"/);
    expect(html).toMatch(/<h1 id="two" data-source-line="7"/);
  });

  it("inlines local images, which the app cannot fetch, and leaves remote ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "md-"));
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(join(dir, "dot.png"), pixel);
    const { html } = await renderMarkdown(
      join(dir, "a.md"),
      "![dot](dot.png) ![web](https://example.org/x.png)\n",
    );
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('src="https://example.org/x.png"');
    const deck = await renderMarkdown(join(dir, "d.md"), "---\nmarp: true\n---\n![bg](dot.png)\n");
    expect(deck.html).toContain("data:image/png;base64,");
  });
});
