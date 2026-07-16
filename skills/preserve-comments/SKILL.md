---
name: preserve-comments
description: Use whenever editing or refactoring existing code in this repo, especially anything touching Docs/Slides/Common/Workspace TypeScript or Apps Script files.
---

# Preserve Comments

Existing comments in this codebase are load-bearing context for future agents (and humans). Many describe specific past bugs, race conditions, Apps Script platform quirks, or non-obvious behavior that a casual reader would otherwise "clean up" and re-break. Treat them as part of the source code, not decoration.

## Default behavior

- When editing a block, **keep all surrounding comments by default**. If a comment no longer matches the code, **edit it** to match — do not delete it.
- When refactoring or moving code, move the comments with it. Do not strip them just because the surrounding shape changed.
- When deleting code, only delete the comments that were specifically about that code. Comments describing nearby invariants, gotchas, or platform behavior stay.
- When adding a workaround, a magic number, or anything non-obvious, **add** a comment explaining the *why* — preferably with `// REASON:` or `// NOTE:` prefix so future agents recognize it as intentional context, not noise.

## Comments that especially must not be deleted

- `// REASON:` and `// NOTE:` comments — these are deliberate signals from a past agent or maintainer that the line below is non-obvious.
- Comments referencing prior bugs by symptom (e.g., "without this the sidebar reports no equations found", "0x0D vs 0x0A in Docs vs Slides").
- Comments describing Apps Script platform behavior (sandbox modes, AuthMode.LIMITED vs FULL, simple vs installable triggers, library `developmentMode`, runtime cache TTLs).
- Comments about timing/ordering ("X must happen before Y because…", `Utilities.sleep` rationales).
- Comments labeling known-stale or temporary code with cleanup conditions ("remove after Marketplace v8 lands", `@deprecated`).
- Comments documenting magic numbers, sentinel return values (`-100000`, `-100001`), enum-value-load-bearing notes for cross-file `const enum` mirroring.

## When in doubt

If you're tempted to delete a comment, ask one of:

- Does this comment describe a behavior that's still true? → keep it as-is.
- Is the behavior true but the wording stale? → **edit** the comment to match current reality; preserve the underlying detail.
- Is the comment plainly wrong now? → edit to a corrected version; do not silently drop the prior context.
- Is the comment trivially restating the code ("// increment counter")? → safe to drop. But: are you sure it's not subtly disambiguating something? When unsure, keep it.

## Example: editing, not deleting

Bad refactor:
```ts
// REASON: -100000 marks placeImage failure so callers can distinguish from success.
return -100000;
```
becomes
```ts
return null;
```
The reason got dropped, and the next agent has no idea why the function used a sentinel pattern. If a future caller still expects `-100000`, they hit a silent bug.

Good refactor:
```ts
// REASON: null marks placeImage failure so callers can distinguish from a successful
// [size, status] tuple. Replaced the previous -100000 sentinel with null after callers
// were updated to handle the union. Keep this distinction — it's used to detect
// "renderer failed entirely" in the auto-fallback path.
return null;
```
The reason persists and now also tells the next agent how the API evolved.

## Why this exists

This codebase has been worked on by multiple AI agents across multiple sessions. Each session can only see what's in the code and the immediate conversation — not the chain of past incidents the comments record. Deleting a comment is deleting institutional memory. Editing one is updating it.
