const SheetsApp = {
	getUi: function(){
		let activeUi = SpreadsheetApp.getUi();
		return activeUi;
	},
	getBody: function(){
		let activeBody = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
		return activeBody;
	},
	getActive: function(){
		let activeDoc = SpreadsheetApp.getActiveSpreadsheet();
		return activeDoc;
	},
	getPageWidth: function() {
		let activeWidth = SpreadsheetApp.getActiveSheet().getMaxRows();
		return activeWidth;
	},
	newlineCharacter: "%0A"
};

const SheetsIntegratedApp = SheetsApp as unknown as AutoLatexCommon.IntegratedApp;
const SHEETS_INLINE_IMAGE_METADATA_KEY = "autolatex-inline-image";

type SheetImage = GoogleAppsScript.Spreadsheet.OverGridImage | GoogleAppsScript.Spreadsheet.CellImage;
type SheetImageAltText = [number, number, number, string];

function buildSheetImageAltText(color: [number, number, number], origURL: string): string {
  return JSON.stringify([...color, origURL]);
}

function parseSheetImageAltText(image: SheetImage): SheetImageAltText | null {
  try {
    const parsed = JSON.parse(image.getAltTextDescription());
    if (!Array.isArray(parsed) || parsed.length < 4) return null;
    const [red, green, blue, origURL] = parsed;
    if (origURL === null || origURL === undefined || origURL === "") return null;
    return [Number(red), Number(green), Number(blue), String(origURL)];
  } catch (err) {
    console.log("Could not parse Auto-LaTeX Sheets image alt text.");
    return null;
  }
}

function removeInlineImageMetadata(cell: GoogleAppsScript.Spreadsheet.Range) {
  cell.getDeveloperMetadata()
    .filter(metadata => metadata.getKey() === SHEETS_INLINE_IMAGE_METADATA_KEY)
    .forEach(metadata => metadata.remove());
}

/**
 * Constantly keep replacing latex till all are finished
 * @public
 */
function replaceEquationsSheets(sizeRaw: string, delimiter: string, renderer: string = "auto") {
  const quality = 900;
  const size = Common.getSize(sizeRaw);
  const isInline = size < 0;
  Common.reportDeltaTime(140);
  const delimiterSet = Common.getDelimiterSet(delimiter);
  Common.savePrefs(sizeRaw, delimiter, renderer);
  // Search for all of the equations within the sheet, and iterate over all of them
  let counter = 0;
  
  for (const delim of delimiterSet) {
    const regex = `${delim[2]}(.*)${delim[3]}`;
    const textFinder = SheetsApp.getActive().createTextFinder(regex)
      .matchEntireCell(true)
      .useRegularExpression(true);

    for (let match = textFinder.findNext(); match !== null; match = textFinder.findNext()) {
      // Remove the delimiters
      const matchValue = String(match.getValue());
      const regexMatch = matchValue.match(regex);
      if (!regexMatch) continue;
      const [, equationOriginal] = regexMatch;
      if (equationOriginal === "") continue;

      // Get the color
      let color: [number, number, number] = [0, 0, 0];
      const rangeColor = match.getTextStyle().getForegroundColorObject()?.asRgbColor();
      if (rangeColor) {
        color = [rangeColor.getRed(), rangeColor.getGreen(), rangeColor.getBlue()];
      }

      const equationEncoded = Common.reEncode(equationOriginal, SheetsIntegratedApp);
      let { renderer, worked, rendererType, resp } = Common.renderEquation(equationEncoded, quality, delim, isInline, ...color);
      if (worked > Common.capableRenderers || !renderer || !resp) return Common.encodeFlag(-2, counter);

      const titleJson = buildSheetImageAltText(color, renderer[2] + equationEncoded + "#" + delim[6]);

      if (isInline) {
        // An in-cell image. Resizes with the cell
        const image = SpreadsheetApp.newCellImage()
          .setSourceUrl(renderer[1])
          .setAltTextDescription(titleJson)
          .build();

        match.setValue(image);

        // This is so that we can easily find it when derendering everything
        match.addDeveloperMetadata(SHEETS_INLINE_IMAGE_METADATA_KEY, GoogleAppsScript.Spreadsheet.DeveloperMetadataVisibility.PROJECT);
      } else {
        // An over-grid image
        const newSize = size || match.getFontSize();

        let scale = (newSize / 100.0);
        if (rendererType.valueOf() === "Texrendr".valueOf())
          //TexRendr
          scale = (newSize / 42.0);
        else if (rendererType.valueOf() === "Roger's renderer".valueOf())
          //Rogers renderer
          scale = (newSize / 200.0);
        else if (rendererType.valueOf() === "Sciweavers".valueOf())
          //Scieweavers
          scale = (newSize / 98.0);
        else if (rendererType.valueOf() === "Sciweavers_old".valueOf())
          //C [75.4, 79.6] on width and height ratio
          scale = (newSize / 76.0);

        const image = SheetsApp.getBody().insertImage(resp.getBlob(), match.getColumn(), match.getRow());
        image.setAltTextDescription(titleJson);
        resizeSheetImage(image, scale);

        match.clearContent();
      }

      counter++;
    }
  }

  /*
  // Force a refresh so the images show up
  // https://issuetracker.google.com/issues/165030751
  const newSheet = SheetsApp.getActive().insertSheet().activate();
  SpreadsheetApp.flush();
  SheetsApp.getActive().deleteSheet(newSheet);
  */

  return Common.encodeFlag(0, counter);
}

/**
 * Resize an OverGridImage, maintaining the aspect ratio
 * @param image The OverGridImage to resize
 * @param height The height of the new image. The width will be calculated
 */
function resizeSheetImage(image: GoogleAppsScript.Spreadsheet.OverGridImage, scale: number) {
  image.setHeight(image.getHeight() * scale);
  image.setWidth(image.getWidth() * scale);
}

function isCellImage(value: any): value is GoogleAppsScript.Spreadsheet.CellImage {
  return value
    && typeof value.getAltTextDescription === "function"
    && typeof value.getContentUrl === "function"
    && typeof value.toBuilder === "function";
}

/**
 * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
 * See DerenderResult in Common for more info on return values
 *
 * @param {string} sizeRaw     Sidebar-selected size.
 * @public
 */

function derenderEquationSheets(sizeRaw: string, delimiter: string, renderer: string = "auto") {
  const defaultDelim = Common.getDelimiters(delimiter);
  Common.savePrefs(sizeRaw, delimiter, renderer);
  const cell = SheetsApp.getBody().getCurrentCell();
  if (cell) {
    const val = cell.getValue();
    if (isCellImage(val)) {
      const result = derenderSingleSheetImage(val, cell, defaultDelim);
      if (result === Common.DerenderResult.Success) removeInlineImageMetadata(cell);
      return result;
    } else {
      // Iterate over all of the OverGridImages on the sheet until we find the one
      const images = SheetsApp.getBody().getImages();
      const a1Notation = cell.getA1Notation();
      const image = images.find(i => i.getAnchorCell().getA1Notation() === a1Notation);

      if (image) {
        const result = derenderSingleSheetImage(image, cell, defaultDelim);
        if (result === Common.DerenderResult.Success) image.remove();
        return result;
      } else {
        return Common.DerenderResult.CursorNotFound;
      }
    }
  } else {
    return Common.DerenderResult.NonExistentElement;
  }
}

function derenderAllSheets(delimiter: string) {
  const defaultDelim = Common.getDelimiters(delimiter);
  let successCount = 0;

  // Derender each OverGridImage, and remove the successful ones
  const images = SheetsApp.getActive().getImages();
  images.forEach(image => {
    const result = derenderSingleSheetImage(image, image.getAnchorCell(), defaultDelim);
    if (result === Common.DerenderResult.Success) {
      image.remove();
      successCount++;
    }
  });

  SheetsApp.getActive().getSheets().forEach(sheet => {
    const range = sheet.getDataRange();
    const values = range.getValues();

    values.forEach((row, rowOffset) => {
      row.forEach((value, colOffset) => {
        if (!isCellImage(value)) return;

        const cell = range.offset(rowOffset, colOffset, 1, 1);
        const result = derenderSingleSheetImage(value, cell, defaultDelim);
        if (result === Common.DerenderResult.Success) {
          removeInlineImageMetadata(cell);
          successCount++;
        }
      });
    });
  });

  return successCount;
}

function derenderSingleSheetImage(image: GoogleAppsScript.Spreadsheet.OverGridImage | GoogleAppsScript.Spreadsheet.CellImage, cell: GoogleAppsScript.Spreadsheet.Range, defaultDelim: AutoLatexCommon.Delimiter) {
  const parsedAltText = parseSheetImageAltText(image);
  if (!parsedAltText) return Common.DerenderResult.InvalidUrl;
  const [red, green, blue, origURL] = parsedAltText;
  const colors = [red, green, blue].map(x => Number(x).toString(16).padStart(2, '0'));

  if (!origURL) return Common.DerenderResult.NullUrl;

  const result = Common.derenderEquation(origURL, SheetsIntegratedApp);
  if (!result) return Common.DerenderResult.InvalidUrl;
  const { delim: newDelim, origEq } = result;
  const delim = newDelim || defaultDelim;

  if (origEq.length <= 0) {
    console.log("Empty equation derender.");
    return Common.DerenderResult.EmptyEquation;
  }

  cell.setValue(delim[0] + origEq + delim[1]).setFontColorObject(SpreadsheetApp.newColor().setRgbColor(`#${colors[0]}${colors[1]}${colors[2]}`).build());

  return Common.DerenderResult.Success;
}
