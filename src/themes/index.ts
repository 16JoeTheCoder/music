export const keys = [
  "background",
  "surface",
  "raised",
  "text",
  "muted",
  "border",
  "accent",
  "accentText",
  "danger",
  "focus",
] as const;
export type Theme = {
  format: "still-theme";
  version: 1;
  id: string;
  name: string;
  mode: "light" | "dark";
  colors: Record<(typeof keys)[number], string>;
  font: "sans" | "mono";
  radius: number;
};
export const light: Theme = {
  format: "still-theme",
  version: 1,
  id: "still-light",
  name: "Still Light",
  mode: "light",
  colors: {
    background: "#f7f6f0",
    surface: "#efeee7",
    raised: "#ffffff",
    text: "#252d26",
    muted: "#536051",
    border: "#c7cfc4",
    accent: "#365644",
    accentText: "#ffffff",
    danger: "#a12a31",
    focus: "#346fcb",
  },
  font: "sans",
  radius: 12,
};
export const code: Theme = {
  ...light,
  id: "still-code",
  name: "Still Code",
  mode: "dark",
  colors: {
    background: "#101419",
    surface: "#171e26",
    raised: "#202a35",
    text: "#e6edf3",
    muted: "#a6b6c8",
    border: "#455365",
    accent: "#8bd5b4",
    accentText: "#10251c",
    danger: "#ff9da5",
    focus: "#8bbcff",
  },
  font: "mono",
  radius: 8,
};
export function validateTheme(value: unknown): Theme {
  const t = value as Theme;
  if (
    !t ||
    t.format !== "still-theme" ||
    t.version !== 1 ||
    !/^[-a-z0-9]{1,64}$/.test(t.id) ||
    typeof t.name !== "string" ||
    !t.name.trim() ||
    t.name.length > 60 ||
    !["light", "dark"].includes(t.mode) ||
    !["sans", "mono"].includes(t.font) ||
    !Number.isInteger(t.radius) ||
    t.radius < 0 ||
    t.radius > 20 ||
    !t.colors ||
    keys.some((k) => !/^#[0-9a-f]{6}$/i.test(t.colors[k]))
  )
    throw Error("Invalid theme. Use the exported version 1 theme schema.");
  if (
    Object.keys(t).some(
      (k) =>
        ![
          "format",
          "version",
          "id",
          "name",
          "mode",
          "colors",
          "font",
          "radius",
        ].includes(k),
    ) ||
    Object.keys(t.colors).some((k) => !keys.includes(k as any))
  )
    throw Error("Theme has unsupported fields");
  const lum = (hex: string) => {
    const rgb = hex
      .slice(1)
      .match(/../g)!
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  for (const [a, b, min] of [
    ["text", "background", 4.5],
    ["text", "surface", 4.5],
    ["text", "raised", 4.5],
    ["muted", "background", 4.5],
    ["muted", "surface", 4.5],
    ["muted", "raised", 4.5],
    ["accentText", "accent", 4.5],
    ["focus", "background", 3],
    ["accent", "background", 4.5],
    ["accent", "surface", 4.5],
    ["accent", "raised", 4.5],
    ["danger", "background", 4.5],
    ["danger", "surface", 4.5],
    ["danger", "raised", 4.5],
  ] as const) {
    const l = lum(t.colors[a]),
      r = lum(t.colors[b]);
    if ((Math.max(l, r) + 0.05) / (Math.min(l, r) + 0.05) < min)
      throw Error(`Theme contrast too low: ${a} against ${b}`);
  }
  return structuredClone(t);
}
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const k of keys) root.style.setProperty("--" + k, theme.colors[k]);
  root.style.setProperty("--radius", theme.radius + "px");
  root.style.setProperty(
    "--detail-font",
    theme.font === "mono"
      ? "ui-monospace, SFMono-Regular, Consolas, monospace"
      : "inherit",
  );
  root.style.setProperty("--heading-font",theme.font==="mono"?"DM Sans":"DM Serif Display");
  root.style.colorScheme = theme.mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.colors.background);
}
export const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Still theme",
  type: "object",
  additionalProperties: false,
  required: [
    "format",
    "version",
    "id",
    "name",
    "mode",
    "colors",
    "font",
    "radius",
  ],
  properties: {
    format: { const: "still-theme" },
    version: { const: 1 },
    id: { type: "string", pattern: "^[-a-z0-9]{1,64}$" },
    name: { type: "string", minLength: 1, maxLength: 60 },
    mode: { enum: ["light", "dark"] },
    font: { enum: ["sans", "mono"] },
    radius: { type: "integer", minimum: 0, maximum: 20 },
    colors: {
      type: "object",
      additionalProperties: false,
      required: keys,
      properties: Object.fromEntries(
        keys.map((k) => [k, { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }]),
      ),
    },
  },
};
export const guide = `# Still theme authoring — version 1

This document is self-contained context for humans and AI agents. Create one JSON file ending .still-theme.json. Start from one of the included complete examples. Do not modify application code to install a theme.

## Contract
Required top-level fields: format (exactly still-theme), version (1), id (unique lowercase letters/digits/hyphens, max64), name (1–60 characters), mode (light/dark), colors (all ten semantic tokens), font (sans/mono), radius (integer0–20). All colors must be six-digit hex. Extra fields are rejected. Keep files below32KiB. No CSS, HTML, JavaScript, URLs, remote fonts or assets. Themes only affect appearance, never app behavior.

## Tokens and coverage
background: page, player and dialog surroundings. surface: navigation and secondary areas. raised: menus, forms and cards. text: titles/body and input text. muted: supporting labels, times and empty-state descriptions. border: dividers and input outlines. accent: primary actions, active selection, progress. accentText: text on accent buttons. danger: destructive actions and errors. focus: keyboard outline. radius: corner radius. font=mono affects times and technical details, while track titles stay readable sans-serif.

## Accessibility
Runtime validation requires4.5:1 for text/muted against background, surface and raised;4.5:1 for accentText/accent;3:1 focus/background. Test focus against other surfaces too. Retain native44px touch targets, reduced motion, disabled controls, progress labels and error semantics. Do not communicate state only by color.

## Workflow
1. Copy a built-in example and set a unique id/name.
2. Edit approved tokens only; check the JSON schema.
3. In Settings → Appearance, Import theme. Preview is temporary until Apply. Cancel restores the saved selection.
4. Test Library, queue, settings, upload/download progress, error and empty states, dialog focus, player sliders and narrow mobile layouts.
5. Export the resulting theme and import again to verify the round trip. Reset with Still Light or System.

## Persistence and compatibility
Themes and selection are local to this browser/device, available offline and included in metadata backup. They are not executable plugins. Built-in IDs are reserved. Future incompatible schemas must change version; importers reject unsupported versions rather than guessing. Missing/corrupt saved themes fall back to Still Light. Browser storage clearing removes custom themes.

## Submission checklist
Valid JSON, all tokens supplied, no unknown fields, unique id, contrast passing, keyboard/mobile checks, light/dark color-scheme correct, export/import verified. Explain any intentional stylistic changes in your accompanying message; do not put unsupported commentary fields in JSON.
`;
