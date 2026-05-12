---
name: apps-script-push
description: Use when pushing this repo's Common, Docs, Slides, or Workspace projects to their remote Google Apps Script projects, especially when library linking, sidebar builds, or deployment/version confusion could cause a bad push.
---

# Apps Script Push

Use this workflow for any request to push code from this repo to the remote Apps Script project.

## Push Commands

- `Common`: run `clasp push` from [Common/.clasp.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Common/.clasp.json).
- `Docs`: run `npm run clasp-push` from [Docs/package.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Docs/package.json).
- `Slides`: run `npm run clasp-push` from [Slides/package.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Slides/package.json).
- `Workspace`: run `npm run clasp-push` from [Workspace/package.json](/Users/aayushgupta/Documents/.projects.nosync/autolatex/Workspace/package.json).

## Production Safety

Treat production Apps Script projects as live user-impacting systems.

Do not hard-code production script IDs in this skill. If production IDs are needed for target checks, load them from a local untracked `.env` file:

- `AUTOLATEX_PROD_COMMON_SCRIPT_ID`
- `AUTOLATEX_PROD_DOCS_SCRIPT_ID`

Do not push test or debugging changes to these production projects unless the user explicitly asks for a production push or restore. This is especially important for `Common`: some already-published Docs versions may reference `Common` with `version: "0"` and `developmentMode: true`, so pushing `Common` HEAD can immediately change production behavior without a new Docs version or Marketplace publish.

For testing, use a separate Apps Script project or deployment, not production `Common` or production `Docs`. Before any push, print the target `.clasp.json` script ID and say whether it matches a production ID from `.env`, is a non-production target, or cannot be classified because `.env` is missing.

Do not create Apps Script versions, deployments, or ask the user to update Marketplace SDK App Configuration unless the user explicitly requests a production release or rollback. If a version/deployment is created by mistake, mark it as unused and do not tell the user to publish it.

## Why `npm run clasp-push`

For `Docs`, `Slides`, and `Workspace`, do not use raw `clasp push` by default.

- The checked-in manifest keeps the `Common` library ID blank.
- The `preclasp-push` script links the correct `Common` library ID.
- `Docs` and `Slides` also rebuild `SidebarJS.html` before pushing.
- The `postclasp-push` script unlinks the library ID again so git stays clean.

Equivalent manual flow:

```bash
node ../LibraryLinker.js link Docs
clasp push
node ../LibraryLinker.js unlink Docs
```

Swap `Docs` for `Slides` or `Workspace` as needed.

## Validation

Before pushing:

- Check `git status --short` and make sure only intended files are going up.
- For Docs and Slides, confirm [BuildSidebarJS.js](/Users/aayushgupta/Documents/.projects.nosync/autolatex/BuildSidebarJS.js) has been run through the package script.
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
