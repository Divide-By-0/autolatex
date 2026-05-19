---
name: apps-script-push
description: Use when pushing this repo's Common, Docs, Slides, Sheets, or Workspace projects to their remote Google Apps Script projects, especially when library linking, sidebar builds, or deployment/version confusion could cause a bad push.
---

# Apps Script Push

Use this workflow for any request to push code from this repo to the remote Apps Script project.

## Push Commands

- `Common`: run `clasp push` from [Common/.clasp.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Common/.clasp.json).
- `Docs`: run `npm run clasp-push` from [Docs/package.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Docs/package.json).
- `Slides`: run `npm run clasp-push` from [Slides/package.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Slides/package.json).
- `Sheets`: run `npm run clasp-push` from [Sheets/package.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Sheets/package.json). Sheets is a real SpreadsheetApp-based project as of 2026-05-18 (previously it was a stale DocumentApp fork); it links Common like Docs/Slides do.

## Production Safety

Treat production Apps Script projects as live user-impacting systems.

Do not hard-code production script IDs in this skill. If production IDs are needed for target checks, load them from a local untracked `.env` file:

- `AUTOLATEX_PROD_COMMON_SCRIPT_ID`
- `AUTOLATEX_PROD_DOCS_SCRIPT_ID`
- `AUTOLATEX_PROD_SLIDES_SCRIPT_ID` — the live Slides Marketplace add-on; what `Slides/.clasp.json` points at by default.
- `AUTOLATEX_PROD_SLIDES_VERSIONS_SCRIPT_ID` — separate Slides project where new prod versions are cut before the SDK App Config flips to them. Not the live add-on, but still production-adjacent.
- `AUTOLATEX_TEST_SLIDES_SCRIPT_ID` — Slides sandbox for ad-hoc testing; safe to push freely.

Do not push test or debugging changes to these production projects unless the user explicitly asks for a production push or restore. This is especially important for `Common`: some already-published Docs versions may reference `Common` with `version: "0"` and `developmentMode: true`, so pushing `Common` HEAD can immediately change production behavior without a new Docs version or Marketplace publish.

For testing, use the Slides test sandbox (`AUTOLATEX_TEST_SLIDES_SCRIPT_ID`) or a separate Apps Script project, not production `Common`, `Docs`, or the live Slides add-on. Before any push, print the target `.clasp.json` script ID and say which env-var (if any) it matches, or that it cannot be classified because `.env` is missing.

Do not create Apps Script versions, deployments, or ask the user to update Marketplace SDK App Configuration unless the user explicitly requests a production release or rollback. If a version/deployment is created by mistake, mark it as unused and do not tell the user to publish it.

## Why `npm run clasp-push`

For `Docs`, `Slides`, `Sheets`, and `Workspace`, do not use raw `clasp push` by default.

- The checked-in manifest keeps the `Common` library ID blank.
- The `preclasp-push` script links the correct `Common` library ID.
- `Docs`, `Slides`, and `Sheets` also rebuild `SidebarJS.html` before pushing.
- The `postclasp-push` script unlinks the library ID again so git stays clean.

Equivalent manual flow:

```bash
node ../LibraryLinker.js link Docs
clasp push
node ../LibraryLinker.js unlink Docs
```

Swap `Docs` for `Slides`, `Sheets`, or `Workspace` as needed.

### Pushing Slides to a non-default script ID

The checked-in `Slides/.clasp.json` always points at `AUTOLATEX_PROD_SLIDES_SCRIPT_ID` (the live Marketplace add-on). To push to `AUTOLATEX_PROD_SLIDES_VERSIONS_SCRIPT_ID` or `AUTOLATEX_TEST_SLIDES_SCRIPT_ID` instead:

1. `cp Slides/.clasp.json Slides/.clasp.json.bak`
2. Overwrite `Slides/.clasp.json` with `{"scriptId":"<target>"}` (the staging/test projects don't have GCP `projectId` linkage).
3. Run `npm run clasp-push --common_version=<n> -- --force` from `Slides/`. The `--force` is needed because `clasp` sees the local tree as unchanged after the previous push and skips otherwise.
4. Restore `Slides/.clasp.json` from `.clasp.json.bak` and delete the backup.

Always restore before doing anything else — a left-over wrong script ID in `.clasp.json` is how a test push lands on the live add-on.

## Validation

Before pushing:

- Check `git status --short` and make sure only intended files are going up.
- For Docs, Slides, and Sheets, confirm [BuildSidebarJS.js](/Users/aayushgupta/Documents/.projects.nosync/autolatex/BuildSidebarJS.js) has been run through the package script.
- If pushing Docs, inspect the manifest that will be uploaded and verify `Common` is pinned to a numbered library version with `developmentMode: false` for production releases.
- If `clasp push` prints `Skipping push`, do not create a new version from it. Either investigate why the push skipped or intentionally rerun with `--force` only after confirming the target is correct.

After pushing:

- Verify the remote project content with `clasp pull` into a temp directory or by inspecting the script editor.
- If a behavior test still shows old code, assume the user is running an older deployment, not project head.
- For production versions, verify the immutable version content through the Apps Script API or Script Editor before telling the user to publish it in GCP.

## Deployment Caveat

`clasp push` updates the Apps Script project head. It does not automatically update versioned deployments used by installed add-ons.

If the user tests via an installed add-on or deployment URL:

- create/update the Apps Script deployment after the push, or
- have them test from the current project head in the script editor.

If logs show an old version number after a push, the problem is usually deployment state, not the push itself.

## Fallbacks

- If `clasp push` fails with `Invalid ID`, the library was not linked. Use the package script or manual linker flow.
- If the installed `clasp` is flaky and appears to skip files, verify by pulling the remote project into a temp directory before assuming the push worked.
- If an Apps Script API push fallback is used, preserve remote-only files unless the user explicitly asks to remove them.
