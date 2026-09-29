These are real public CodeCogs responses captured on 2026-09-29:

- `valid.json`: `https://latex.codecogs.com/png.json?%5Cdpi%7B900%7Dx%2B1`
- `invalid-dpi.json`: `https://latex.codecogs.com/png.json?%5Cdpi900x%2B1`

Both return HTTP 200 with a PNG in `latex.base64`; the second reports
`valid: false` and `Unknown command: \\dpi`. Its PNG depicts the rejected command.
This reproduces the error-artwork acceptance defect. It does **not** reproduce
why a correctly braced DPI prefix was mishandled in the historical reports.
The PNG endpoint renders the correctly braced prefix normally at capture time.

The regression suite runs the real Common renderer against these network-boundary
fixtures. It also checks Docs/Sheets source preservation and Slides' use of the
validated bytes. Host application APIs are mocked; actual Google insertion and
future third-party service behavior require deployment smoke testing.
