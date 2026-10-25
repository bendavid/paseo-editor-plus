import type { PreviewProvider } from "./types";

// Markdown and Marp, rendered on the daemon host from the editor's text (saved or not), so the
// preview follows typing. It needs no language server.

/** Wait after typing before rendering again. */
const RENDER_DELAY_MS = 200;

export const markdownPreview: PreviewProvider = {
  needsServer: false,

  async start(services) {
    const { calls, filePath, web } = services;
    const view = web.mountDocumentPreview(services.parent, {
      theme: services.theme,
      invert: services.invert,
      onLine: (line) => services.jump({ path: filePath, start: { line, character: 0 }, end: null }),
      onLink: (href) => {
        if (/^https?:\/\//i.test(href)) services.openExternal(href);
        else services.notice(`${href} is a file link. Open it from Files.`);
      },
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let rendering = false;
    let again = false;
    let destroyed = false;
    const render = async () => {
      if (rendering) {
        again = true;
        return;
      }
      rendering = true;
      try {
        const result = await calls.renderMarkdown({ file: filePath, text: services.text() });
        if (!destroyed) view.setContent(result.html, result.css, result.kind);
      } catch (error) {
        if (!destroyed) services.notice(`The preview could not be rendered: ${String(error)}`);
      } finally {
        rendering = false;
        if (again && !destroyed) {
          again = false;
          void render();
        }
      }
    };
    await render();
    return {
      deliver() {},
      reveal: (position) => view.scrollToLine(position.line),
      textChanged() {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void render();
        }, RENDER_DELAY_MS);
      },
      saved() {},
      setInvert: (invert) => view.setInvert(invert),
      setTheme: (theme) => view.setTheme(theme),
      destroy() {
        destroyed = true;
        if (timer !== null) clearTimeout(timer);
        view.destroy();
      },
    };
  },

  sourceJump: () => null,
  swallows: () => false,
};
