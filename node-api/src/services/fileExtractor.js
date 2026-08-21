const fs = require('fs/promises');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

async function extractText(filePath) {
  try {
    await fs.access(filePath);
  } catch (err) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text.trim();
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  }

  if (ext === '.txt' || ext === '.doc') {
    const dataBuffer = await fs.readFile(filePath);
    // Note: handling .doc as text assumes it's actually just plain text or we fallback to basic raw text
    return dataBuffer.toString('utf8').trim();
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = {
  extractText,
};
