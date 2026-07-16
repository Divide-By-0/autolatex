# Repo Instructions

When asked to push or deploy this repo's Google Apps Script projects, first read [skills/apps-script-push/SKILL.md](/Users/aayushgupta/Documents/.projects.nosync/autolatex/skills/apps-script-push/SKILL.md).

Use that skill for:

- pushing `Common`, `Docs`, `Slides`, `Sheets`, or `Workspace`
- handling `clasp` library-linking issues
- rebuilding Docs / Slides / Sheets sidebars before a push
- distinguishing project head pushes from versioned deployment updates

When editing this repo, also follow [skills/preserve-comments/SKILL.md](/Users/aayushgupta/Documents/.projects.nosync/autolatex/skills/preserve-comments/SKILL.md): existing `REASON:` / `NOTE:` comments encode past incidents and platform quirks — edit them rather than deleting them during refactors.

## Sheets ↔ Docs parity

`Sheets/Code.ts` is a structurally-parallel port of `Docs/Code.ts` adapted to Apps Script's `SpreadsheetApp` API. Shared logic (renderer fetching, delimiter parsing, equation encoding, the `RenderEquationResult` type with `authorizationError`) lives in the `Common` library and is consumed identically by Docs, Slides, and Sheets. Sheets-specific differences:

- **Content model**: cells, not paragraphs. Equations are whole-cell — a cell whose entire value matches `<delim>…<delim>` is treated as one equation. Mixed-text-and-equation in a single cell is unsupported (users should split into separate cells).
- **Image insertion**: `Sheet.insertImage(blob, column, row)` returns an `OverGridImage`. Sheets has no inline-image-in-text concept like Docs's `Paragraph.insertInlineImage`.
- **Round-trip storage**: the original LaTeX is stored in `OverGridImage.setAltTextDescription` (base64-encoded with the `ALE-Latex:` prefix). De-rendering reads that back, restores the cell value, and removes the image.
- **No MathJax client renderer** in Sheets yet — server-only via `Common.renderEquation`. The MathJax flow in Docs/Slides depends on named ranges and offset-based replacement that Sheets doesn't expose; adding it would need a new Sheets-side anchoring strategy.

When porting a Docs fix to Sheets:

1. Check whether the fix touches Common library code — if so, Sheets picks it up automatically through the library link.
2. Check whether the fix is in `Docs/Code.ts` itself — port it to `Sheets/Code.ts` matching the existing pattern, replacing Document API calls with the equivalent SpreadsheetApp call (`getActiveDocument()` → `getActiveSpreadsheet()`, `Paragraph.insertInlineImage(childIndex, blob)` → `Sheet.insertImage(blob, col, row)`, etc.).
3. Check whether the fix is in `Docs/Sidebar.ts` — Sheets/Sidebar.ts is a simplified version; port only the relevant code paths.
