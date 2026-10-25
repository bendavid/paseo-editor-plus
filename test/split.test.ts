import { describe, expect, it } from "vitest";
import { ratioAt, sideAt } from "../client/web/split";

const rect = { left: 100, right: 1100, top: 50, bottom: 650, width: 1000, height: 600 };

describe("split", () => {
  it("gives the preview the share between the pointer and its edge", () => {
    expect(ratioAt(rect, "right", 700, 300)).toBeCloseTo(0.4);
    expect(ratioAt(rect, "left", 700, 300)).toBeCloseTo(0.6);
    expect(ratioAt(rect, "bottom", 600, 470)).toBeCloseTo(0.3);
    expect(ratioAt(rect, "top", 600, 470)).toBeCloseTo(0.7);
  });

  it("keeps either side at least 15% and 120 px", () => {
    expect(ratioAt(rect, "right", 1095, 300)).toBeCloseTo(0.15);
    expect(ratioAt(rect, "right", 105, 300)).toBeCloseTo(0.85);
    // 600 px tall: 120 px is 20%.
    expect(ratioAt(rect, "bottom", 600, 640)).toBeCloseTo(0.2);
  });

  it("docks on the nearest edge, and stays put near the middle", () => {
    expect(sideAt(rect, 130, 350, "right")).toBe("left");
    expect(sideAt(rect, 1080, 350, "left")).toBe("right");
    expect(sideAt(rect, 600, 70, "right")).toBe("top");
    expect(sideAt(rect, 600, 640, "right")).toBe("bottom");
    expect(sideAt(rect, 600, 350, "right")).toBe("right");
    expect(sideAt(rect, 600, 350, "top")).toBe("top");
  });
});
