const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

/**
 * Extract plain text from an uploaded PDF/DOCX/TXT/DOC file.
 * Non-AI — used on upload so raw_text is populated before pg-boss workers run.
 */
async function extractText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer);
    const text = (result.text || "").trim();
    if (!text) throw new Error("Extracted empty text from PDF");
    return text;
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    const text = (result.value || "").trim();
    if (!text) throw new Error("Extracted empty text from DOCX");
    return text;
  }

  if (ext === ".txt" || ext === ".doc") {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) throw new Error("Extracted empty text from text file");
    return text;
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = { extractText };
