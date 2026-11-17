# Still theme authoring — version 1

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

## Schema
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Still theme",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "format",
    "version",
    "id",
    "name",
    "mode",
    "colors",
    "font",
    "radius"
  ],
  "properties": {
    "format": {
      "const": "still-theme"
    },
    "version": {
      "const": 1
    },
    "id": {
      "type": "string",
      "pattern": "^[-a-z0-9]{1,64}$"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 60
    },
    "mode": {
      "enum": [
        "light",
        "dark"
      ]
    },
    "font": {
      "enum": [
        "sans",
        "mono"
      ]
    },
    "radius": {
      "type": "integer",
      "minimum": 0,
      "maximum": 20
    },
    "colors": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "background",
        "surface",
        "raised",
        "text",
        "muted",
        "border",
        "accent",
        "accentText",
        "danger",
        "focus"
      ],
      "properties": {
        "background": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "surface": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "raised": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "text": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "muted": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "border": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "accent": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "accentText": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "danger": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        },
        "focus": {
          "type": "string",
          "pattern": "^#[0-9a-fA-F]{6}$"
        }
      }
    }
  }
}
```
## Light example
```json
{
  "format": "still-theme",
  "version": 1,
  "id": "still-light",
  "name": "Still Light",
  "mode": "light",
  "colors": {
    "background": "#f7f6f0",
    "surface": "#efeee7",
    "raised": "#ffffff",
    "text": "#252d26",
    "muted": "#536051",
    "border": "#c7cfc4",
    "accent": "#365644",
    "accentText": "#ffffff",
    "danger": "#a12a31",
    "focus": "#346fcb"
  },
  "font": "sans",
  "radius": 12
}
```
## Code example
```json
{
  "format": "still-theme",
  "version": 1,
  "id": "still-code",
  "name": "Still Code",
  "mode": "dark",
  "colors": {
    "background": "#101419",
    "surface": "#171e26",
    "raised": "#202a35",
    "text": "#e6edf3",
    "muted": "#a6b6c8",
    "border": "#455365",
    "accent": "#8bd5b4",
    "accentText": "#10251c",
    "danger": "#ff9da5",
    "focus": "#8bbcff"
  },
  "font": "mono",
  "radius": 8
}
```
