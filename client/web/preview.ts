import type { PreviewChannel, PreviewFrame, PreviewView } from "../web-contract";

// A preview page, such as tinymist's (a self-contained HTML document with its renderer and
// WebAssembly inlined), talks to its server over a WebSocket. Here it runs in an iframe, and its WebSocket is
// replaced by one that travels through the session: the plugin server holds the real connection
// on the daemon host, and its messages arrive on the session's subscription, binary ones as raw
// bytes. So the preview works wherever the app reaches the daemon,
// over SSH or the relay included, without exposing a port.
//
// The page is written into an about:blank iframe with document.write rather than given as
// `srcdoc`: the page builds its socket URL from `location.href`, which is the parent's URL for
// a written document and an unparseable "about:srcdoc" otherwise.

interface PreviewSocket {
  open(): void;
  receive(frame: PreviewFrame): void;
  serverClosed(): void;
}

const registry = "__paseoEditorPlusPreviewSockets";
let nextId = 0;

function sockets(): Map<string, unknown> {
  const host = window as unknown as Record<string, Map<string, unknown> | undefined>;
  host[registry] ??= new Map();
  return host[registry];
}

/** A copy in the page's realm: the page checks `data instanceof ArrayBuffer`. */
function pageArrayBuffer(realm: Window, data: Uint8Array): ArrayBuffer {
  const bytes = new (realm as unknown as typeof globalThis).Uint8Array(data.byteLength);
  bytes.set(data);
  return bytes.buffer as ArrayBuffer;
}

/** Writes the page into a new iframe in `parent`. Frames already delivered are kept until it connects. */
export function mountPreview(
  parentElement: unknown,
  html: string,
  channel: PreviewChannel,
  options: { invert: boolean; background: string; invertTarget: string },
): PreviewView {
  let socket: PreviewSocket | null = null;
  let serverOpen = true;
  let pending: PreviewFrame[] = [];
  let destroyed = false;

  const parent = parentElement as HTMLElement;
  const iframe = document.createElement("iframe");
  iframe.title = "Preview";
  Object.assign(iframe.style, { border: "0", width: "100%", height: "100%", display: "block" });
  parent.appendChild(iframe);
  const realm = iframe.contentWindow as Window;

  const attach = (next: PreviewSocket) => {
    socket = next;
    if (serverOpen) {
      next.open();
      const queued = pending;
      pending = [];
      for (const frame of queued) next.receive(frame);
      return;
    }
    channel.reconnect().then(
      () => {
        if (destroyed || socket !== next) return;
        serverOpen = true;
        next.open();
      },
      () => {
        if (socket === next) next.serverClosed();
      },
    );
  };

  /** Stands in for the browser's WebSocket inside the page. */
  class PaseoPreviewSocket extends EventTarget implements PreviewSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = 0;
    binaryType = "arraybuffer";
    bufferedAmount = 0;
    extensions = "";
    protocol = "";
    readonly url: string;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      // The page sets its handlers right after constructing; open after that.
      setTimeout(() => {
        if (!destroyed && this.readyState === 0) attach(this);
      }, 0);
    }

    send(data: unknown): void {
      if (this.readyState !== 1) return;
      if (typeof data === "string") channel.send(data);
    }

    close(): void {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      if (socket === this) socket = null;
      this.fire("close", { code: 1000, reason: "", wasClean: true });
    }

    open(): void {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.fire("open", {});
    }

    receive(frame: PreviewFrame): void {
      if (this.readyState !== 1 || frame.kind === "closed") return;
      const data = frame.kind === "text" ? frame.text : pageArrayBuffer(realm, frame.bytes);
      this.fire("message", { data });
    }

    serverClosed(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (socket === this) socket = null;
      this.fire("close", { code: 1006, reason: "", wasClean: false });
    }

    private fire(type: "open" | "message" | "close", fields: Record<string, unknown>): void {
      const event = new Event(type);
      for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(event, key, { value, enumerable: true });
      }
      this.dispatchEvent(event);
      const handler = this[`on${type}`];
      handler?.call(this, event);
    }
  }

  const id = String(++nextId);
  sockets().set(id, PaseoPreviewSocket);
  const shim = `<script>window.WebSocket = window.parent.${registry}.get(${JSON.stringify(id)});</script>`;
  const style = `<style id="editor-plus-preview-style">
    html, body { background: ${options.background} !important; }
    .editor-plus-invert { filter: invert(1) hue-rotate(180deg); }
  </style>`;
  const head = /<head[^>]*>/i.exec(html);
  const page = head
    ? `${html.slice(0, head.index + head[0].length)}${shim}${style}${html.slice(head.index + head[0].length)}`
    : `${shim}${style}${html}`;
  const doc = iframe.contentDocument as Document;
  doc.open();
  doc.write(page);
  doc.close();

  const content = () => doc.querySelector(options.invertTarget);
  const applyInvert = (invert: boolean) =>
    content()?.classList.toggle("editor-plus-invert", invert);
  let invert = options.invert;
  applyInvert(invert);
  // The page builds its content once it has loaded.
  iframe.contentWindow?.addEventListener("load", () => applyInvert(invert));

  return {
    deliver(frame) {
      if (destroyed) return;
      if (frame.kind === "closed") {
        serverOpen = false;
        pending = [];
        socket?.serverClosed();
        return;
      }
      if (socket) socket.receive(frame);
      else pending.push(frame);
    },
    setInvert(next) {
      invert = next;
      applyInvert(next);
    },
    setBackground(color) {
      const element = doc.getElementById("editor-plus-preview-style");
      if (element) {
        element.textContent = element.textContent.replace(
          /background: [^!]+ !important/,
          `background: ${color} !important`,
        );
      }
    },
    destroy() {
      destroyed = true;
      sockets().delete(id);
      socket = null;
      iframe.remove();
    },
  };
}
