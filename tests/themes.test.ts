import { describe, it, expect } from "vitest";
import { code, light, validateTheme, schema, guide } from "../src/themes";
describe("portable themes", () => {
  it("round trips both complete built-in themes without changing their values", () => {
    for (const t of [light, code])
      expect(validateTheme(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(schema.properties.colors.required).toContain("focus");
    expect(guide).toContain("authoring");
  });
  it("rejects executable and remote content and incompatible or illegible packages", () => {
    for (const t of [
      { ...code, version: 2 },
      { ...code, css: "body{display:none}" },
      { ...code, font: "https://evil.example" },
      { ...code, colors: { ...code.colors, text: code.colors.background } },
      { ...code, colors: { ...code.colors, accent: code.colors.background } },
      { ...code, radius: 999 },
    ])
      expect(() => validateTheme(t)).toThrow();
  });
});
