# Auto-LaTeX-Equations

Auto-LaTeX Equations add-on for Google Docs

## Setup

You need to get the .clasp.json files within Docs/, Slides/, and Sheets/ by dm'ing Aayush.

clasp is used to sync your local folder with the actual code sandbox in the Google Doc/Slide/whatever that's eventually published. We use Github for development with multiple people. You can use clasp to live update the code in the Google sandbox so you dont have to deal with push/pull anymore. More info at https://www.toptal.com/google-docs/extending-google-sheets-app-scripts.

For the Common library, you can use `clasp push -w` to watch for changes and push them to this library. Dependent Apps Script projects will automatically use the development version of the library.

For any projects which depend on the Common library (Slides and Docs), the Common project ID must be added to the manifest file. The `LibraryLinker` script does this for you, and is called when using the `clasp-push` NPM script in Slides and Docs. (This script links the library, runs `clasp push`, then unlinks the library.)

Therefore, to push changes to Slides and Docs, instead of using `clasp-push`, use `npm run clasp-push` in the respective directory, or use the workspace name in the root directory. (e.g. `npm -w Slides run clasp-push`)

If you would like to watch for changes, `npm -w Slides/Docs run clasp-push -- -w` will pass the `-w` flag to `clasp push`.

**However**, `Ctrl+C`'ing the watch will not run the `postclasp-push` script, meaning the Common library will stay linked to the dependent project. To fix this, run `npm -w Slides/Docs run postclasp-push` after stopping the watch.

## Types

Types are built with an updated version of `clasp-types`. To build the types for the Common library, run `npm -w Common run build-types`. This will build the types into the `types/` directory.

## Helpful documentation pages for Slides

[class selection](https://developers.google.com/apps-script/reference/slides/selection)

[selecting items within presentation](https://developers.google.com/apps-script/guides/slides/selecting)

[get position](https://developers.google.com/apps-script/guides/slides/moving-elements)

## Remaining Tasks

To fix slides issues with tables etc: https://docs.google.com/document/d/1ekcCbx1lWtJ--9eprOD0fgfO2YGr2vNn1WzkxTLzpFg/edit?usp=sharing
