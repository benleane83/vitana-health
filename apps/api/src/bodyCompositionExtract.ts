import { createRequire } from "node:module";
import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";

const require = createRequire(import.meta.url);
const englishData = require("@tesseract.js-data/eng") as { langPath: string; gzip: boolean };

export interface BodyCompositionExtractResult {
  text: string;
  diagnostics: string[];
}

const minUsefulPdfTextChars = 80;
const maxOcrPages = 3;

export async function extractBodyCompositionText(buffer: Buffer, mimeType: string): Promise<BodyCompositionExtractResult> {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }
  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    const ocr = await runOcr(buffer);
    return {
      text: ocr.text,
      diagnostics: [`Image OCR confidence: ${Math.round(ocr.confidence)}%.`]
    };
  }
  return {
    text: "",
    diagnostics: [`Unsupported body-composition report MIME type: ${mimeType}.`]
  };
}

async function extractPdfText(buffer: Buffer): Promise<BodyCompositionExtractResult> {
  const diagnostics: string[] = [];
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    const embeddedText = textResult.text.trim();
    if (embeddedText.length >= minUsefulPdfTextChars) {
      return { text: embeddedText, diagnostics };
    }

    diagnostics.push("Embedded PDF text was sparse; rendered pages locally for OCR.");
    const screenshotResult = await parser.getScreenshot({ scale: 2, partial: [1, maxOcrPages], imageBuffer: true });
    const pageTexts: string[] = [];
    for (const page of screenshotResult.pages.slice(0, maxOcrPages)) {
      if (!page.data) {
        continue;
      }
      const ocr = await runOcr(Buffer.from(page.data));
      diagnostics.push(`PDF page ${page.pageNumber} OCR confidence: ${Math.round(ocr.confidence)}%.`);
      pageTexts.push(ocr.text);
    }
    return { text: pageTexts.join("\n").trim(), diagnostics };
  } finally {
    await parser.destroy();
  }
}

async function runOcr(image: Buffer): Promise<{ text: string; confidence: number }> {
  const worker = await Tesseract.createWorker("eng", undefined, {
    langPath: englishData.langPath,
    gzip: englishData.gzip,
    cacheMethod: "none"
  });
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    });
    const result = await worker.recognize(image);
    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence
    };
  } finally {
    await worker.terminate();
  }
}