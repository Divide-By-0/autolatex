const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '../..');

// Model the library boundary using a full emit: transpileModule preserves const
// enums and would invent the very runtime export that production Common lacks.
function compileCommon() {
  const outputs = [];
  const program = ts.createProgram(['Common/Unicode.ts', 'Common/Code.ts'].map(p => path.join(root, p)), {
    target: ts.ScriptTarget.ES5, skipLibCheck: true, types: [],
  });
  program.emit(undefined, (filename, text) => {
    if (filename.endsWith('.js')) outputs.push(text);
  });
  return outputs.join('\n');
}
const commonSource = process.env.ALE_COMMON_JS
  ? fs.readFileSync(process.env.ALE_COMMON_JS, 'utf8') : compileCommon();
const slidesFilename = process.env.ALE_SLIDES_JS || path.join(root, 'Slides/Code.ts');
const slidesSource = process.env.ALE_SLIDES_JS
  ? fs.readFileSync(slidesFilename, 'utf8')
  : ts.transpileModule(fs.readFileSync(slidesFilename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;

function harness(titles, selectionType = 'PAGE_ELEMENT') {
  const restored = [];
  const common = vm.createContext({
    console,
    PropertiesService: { getUserProperties: () => ({ setProperty() {} }) },
  });
  vm.runInContext(commonSource, common, { filename: 'Common.runtime.js' });
  const images = titles.map(title => ({
    removed: false,
    getTitle: () => title,
    getLeft: () => 10, getTop: () => 20,
    getWidth: () => 100, getHeight: () => 30,
    getPageElementType: () => 'IMAGE',
    asImage() { return this; },
    remove() { this.removed = true; },
  }));
  const style = { setForegroundColor() { return this; }, setFontSize() { return this; } };
  const slide = {
    getImages: () => images.filter(image => !image.removed),
    insertShape: () => ({ getText: () => ({ insertText: (_offset, text) => {
      restored.push(text);
      return { getTextStyle: () => style };
    } }) }),
  };
  const selection = {
    getCurrentPage: () => slide,
    getSelectionType: () => selectionType,
    getPageElementRange: () => ({ getPageElements: () => images }),
  };
  const runtime = vm.createContext({
    Common: common, console,
    SlidesApp: {
      getActivePresentation: () => ({ getSlides: () => [slide], getSelection: () => selection }),
      SelectionType: { PAGE_ELEMENT: 'PAGE_ELEMENT' },
      PageElementType: { IMAGE: 'IMAGE' },
      ShapeType: { TEXT_BOX: 'TEXT_BOX' },
    },
  });
  vm.runInContext(slidesSource, runtime, { filename: slidesFilename });
  return { runtime, common, images, restored };
}

function equationTitle() {
  return JSON.stringify({ red: 0, green: 0, blue: 0,
    origURL: 'https://www.codecogs.com/eqnedit.php?latex=x%2B1#0',
    size: 14, width: 100, height: 30 });
}
module.exports = { harness, equationTitle };
