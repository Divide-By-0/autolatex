import { writeFile } from 'fs/promises';

const FILE_URL = 'https://raw.githubusercontent.com/latex3/unicode-math/master/unicode-math-table.tex';

const res = await fetch(FILE_URL);
const text = await res.text();
const symbols = {};
const accents = {};

const lines = text.split('\n');
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('%')) continue;

  // Match lines like: \UnicodeMathSymbol{"00021}{\mathexclam }{\mathclose}{exclamation mark}%
  const match = trimmed.match(/\\UnicodeMathSymbol\{"([0-9A-Fa-f]+)\}\{(\\\w+)\s+\}\{\\(\w+).*/);
  if (match) {
    const codepointHex = match[1];
    const latexCmd = match[2];
    const category = match[3];
    const char = String.fromCodePoint(parseInt(codepointHex, 16));

    if (category === 'mathaccent' || category === 'mathaccentwide') {
      if (!accents[char])
        accents[char] = latexCmd;
    } else {
      if (!symbols[char])
        symbols[char] = latexCmd;
    }
  }
}

await writeFile('Common/Unicode.ts', `const UNICODE_MATH = ${JSON.stringify({
  accents,
  symbols
})};\n`);
