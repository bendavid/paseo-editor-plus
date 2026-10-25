import type { DockSide, SplitDockOptions, SplitResizeOptions } from "../web-contract";

// Dragging the divider between the editor and the preview: resizing by the line, docking the
// preview on another side by the grip. While a drag runs, a transparent shield covers the page, so
// the preview's iframe (Typst) or canvas cannot swallow the pointer, and the editor sees no events.

/** The smallest share either side may get, and the smallest size in pixels. */
const MIN_RATIO = 0.15;
const MIN_PX = 120;
/** Two presses this close together without moving reset the split. */
const DOUBLE_PRESS_MS = 350;

let lastPress = 0;

interface Track {
  move(x: number, y: number): void;
  end(x: number, y: number, cancelled: boolean): void;
}

/** Follows the pointer from a pointerdown until it is released or Escape cancels. */
function track(event: PointerEvent, cursor: string, handlers: Track): void {
  event.preventDefault();
  const shield = document.createElement("div");
  Object.assign(shield.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    cursor,
    background: "transparent",
  });
  document.body.appendChild(shield);
  let x = event.clientX;
  let y = event.clientY;
  const move = (next: PointerEvent) => {
    x = next.clientX;
    y = next.clientY;
    handlers.move(x, y);
  };
  const finish = (cancelled: boolean) => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("keydown", key, true);
    shield.remove();
    handlers.end(x, y, cancelled);
  };
  const up = (next: PointerEvent) => {
    x = next.clientX;
    y = next.clientY;
    finish(false);
  };
  const cancel = () => finish(true);
  const key = (next: KeyboardEvent) => {
    if (next.key !== "Escape") return;
    next.preventDefault();
    next.stopPropagation();
    finish(true);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("keydown", key, true);
}

/** The preview's share of the split, for a pointer at (x, y). */
export function ratioAt(
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number },
  side: DockSide,
  x: number,
  y: number,
): number {
  const size = side === "left" || side === "right" ? rect.width : rect.height;
  let share: number;
  switch (side) {
    case "left":
      share = (x - rect.left) / rect.width;
      break;
    case "right":
      share = (rect.right - x) / rect.width;
      break;
    case "top":
      share = (y - rect.top) / rect.height;
      break;
    case "bottom":
      share = (rect.bottom - y) / rect.height;
      break;
  }
  const min = Math.min(0.5, Math.max(MIN_RATIO, MIN_PX / Math.max(size, 1)));
  return Math.min(1 - min, Math.max(min, share));
}

/** Near the middle, the preview stays where it is. */
const CENTRE = 0.3;

/** The side whose edge is nearest a pointer at (x, y), or `current` near the middle. */
export function sideAt(
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number },
  x: number,
  y: number,
  current: DockSide,
): DockSide {
  const distances: [DockSide, number][] = [
    ["left", (x - rect.left) / rect.width],
    ["right", (rect.right - x) / rect.width],
    ["top", (y - rect.top) / rect.height],
    ["bottom", (rect.bottom - y) / rect.height],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][1] > CENTRE ? current : distances[0][0];
}

export function resizeSplit(options: SplitResizeOptions): void {
  const event = options.event as PointerEvent;
  const container = options.container as HTMLElement;
  const now = Date.now();
  const double = now - lastPress < DOUBLE_PRESS_MS;
  lastPress = now;
  const horizontal = options.side === "left" || options.side === "right";
  const startX = event.clientX;
  const startY = event.clientY;
  let ratio = options.ratio;
  track(event, horizontal ? "col-resize" : "row-resize", {
    move(x, y) {
      ratio = ratioAt(container.getBoundingClientRect(), options.side, x, y);
      options.onRatio(ratio);
    },
    end(x, y, cancelled) {
      const moved = Math.abs(x - startX) + Math.abs(y - startY) > 3;
      if (cancelled) options.onEnd(options.ratio);
      else if (!moved && double) {
        lastPress = 0;
        options.onEnd(0.5);
      } else options.onEnd(moved ? ratio : options.ratio);
    },
  });
}

const LABELS: Readonly<Record<DockSide, string>> = {
  left: "Preview on the left",
  right: "Preview on the right",
  top: "Preview above",
  bottom: "Preview below",
};

export function dockSplit(options: SplitDockOptions): void {
  const event = options.event as PointerEvent;
  const container = options.container as HTMLElement;
  const rect = container.getBoundingClientRect();
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: "2147483001",
    pointerEvents: "none",
  });
  overlay.dataset.testid = "editor-plus-dock-overlay";
  const zone = document.createElement("div");
  Object.assign(zone.style, {
    position: "absolute",
    boxSizing: "border-box",
    border: `2px solid ${options.accent}`,
    borderRadius: "6px",
    background: `color-mix(in srgb, ${options.accent} 22%, transparent)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 13px system-ui, sans-serif",
    color: options.accent,
    transition: "left 90ms, top 90ms, width 90ms, height 90ms",
  });
  overlay.appendChild(zone);
  document.body.appendChild(overlay);
  let side = options.side;
  const show = (target: DockSide) => {
    side = target;
    const share = `${options.ratio * 100}%`;
    const rest = `${(1 - options.ratio) * 100}%`;
    const place: Record<DockSide, Partial<CSSStyleDeclaration>> = {
      left: { left: "0", top: "0", width: share, height: "100%" },
      right: { left: rest, top: "0", width: share, height: "100%" },
      top: { left: "0", top: "0", width: "100%", height: share },
      bottom: { left: "0", top: rest, width: "100%", height: share },
    };
    Object.assign(zone.style, place[target]);
    zone.textContent = LABELS[target];
    zone.dataset.side = target;
  };
  show(options.side);
  track(event, "grabbing", {
    move(x, y) {
      show(sideAt(rect, x, y, options.side));
    },
    end(_x, _y, cancelled) {
      overlay.remove();
      if (!cancelled) options.onDock(side);
    },
  });
}
