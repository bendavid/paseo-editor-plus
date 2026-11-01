import { describe, expect, it } from "vitest";
import { LANGUAGES, languageIdFor } from "../shared/languages";

describe("language profiles", () => {
  it("open CUDA sources and headers in the C/C++ profile, as cuda-cpp", () => {
    const cpp = LANGUAGES.find((language) => language.id === "cpp")!;
    expect(languageIdFor(cpp, "cu")).toBe("cuda-cpp");
    expect(languageIdFor(cpp, "CUH")).toBe("cuda-cpp");
    expect(languageIdFor(cpp, "cpp")).toBe("cpp");
  });

  it("claim each extension once", () => {
    const extensions = LANGUAGES.flatMap((language) => Object.keys(language.extensions));
    expect(new Set(extensions).size).toBe(extensions.length);
  });
});
