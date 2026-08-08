import { createRequire } from "node:module";
import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";
import { parseBodyCompositionText } from "@vitana/shared";
import { createBodyCompositionDateImage } from "./bodyCompositionDocumentImage.js";

const require = createRequire(import.meta.url);
const englishData = require("@tesseract.js-data/eng") as { langPath: string; gzip: boolean };

export interface BodyCompositionExtractResult {
  text: string;
  diagnostics: string[];
}

const minUsefulPdfTextChars = 80;
const pdfPageMarkerPattern = /--\s*\d+\s+of\s+\d+\s*--/g;

export async function extractBodyCompositionText(buffer: Buffer, mimeType: string): Promise<BodyCompositionExtractResult> {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }
  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    const ocr = await runOcr(buffer);
    const diagnostics = [`Image OCR confidence: ${Math.round(ocr.confidence)}%.`];
    if (hasReportDate(ocr.text)) return { text: ocr.text, diagnostics };

    const dateImage = await createBodyCompositionDateImage(buffer, mimeType);
    if (!dateImage) return { text: ocr.text, diagnostics };

    const dateOcr = await runOcr(dateImage);
    diagnostics.push(`Isolated report-header OCR confidence: ${Math.round(dateOcr.confidence)}%.`);
    if (hasReportDate(dateOcr.text)) {
      diagnostics.push("Recovered the report date from an isolated document header.");
      return { text: `${dateOcr.text}\n${ocr.text}`.trim(), diagnostics };
    }
    return {
      text: ocr.text,
      diagnostics
    };
  }
  return {
    text: "",
    diagnostics: [`Unsupported body-composition report MIME type: ${mimeType}.`]
  };
}

function hasReportDate(text: string): boolean {
  return Boolean(parseBodyCompositionText("report.jpg", text).reportDate);
}

async function extractPdfText(buffer: Buffer): Promise<BodyCompositionExtractResult> {
  const diagnostics: string[] = [];
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    const embeddedText = textResult.text.replace(pdfPageMarkerPattern, "").trim();
    if (embeddedText.length >= minUsefulPdfTextChars) {
      return { text: embeddedText, diagnostics };
    }

    diagnostics.push("Embedded PDF text was sparse; rendered pages locally for OCR.");
    const pageCount = Math.max(0, textResult.total);
    const screenshotResult = await parser.getScreenshot({ scale: 2, first: pageCount, imageBuffer: true });
    const pageTexts: string[] = [];
    const worker = await createOcrWorker();
    try {
      for (const page of screenshotResult.pages) {
        if (!page.data) {
          continue;
        }
        const ocr = await recognizeWithWorker(worker, Buffer.from(page.data));
        diagnostics.push(`PDF page ${page.pageNumber} OCR confidence: ${Math.round(ocr.confidence)}%.`);
        pageTexts.push(ocr.text);
      }
    } finally {
      await worker.terminate();
    }
    return { text: pageTexts.join("\n").trim(), diagnostics };
  } finally {
    await parser.destroy();
  }
}

async function runOcr(image: Buffer): Promise<{ text: string; confidence: number }> {
  const worker = await createOcrWorker();
  try {
    return await recognizeWithWorker(worker, image);
  } finally {
    await worker.terminate();
  }
}

async function createOcrWorker(): ReturnType<typeof Tesseract.createWorker> {
  return Tesseract.createWorker("eng", undefined, {
    langPath: englishData.langPath,
    gzip: englishData.gzip,
    cacheMethod: "none"
  });
}

async function recognizeWithWorker(worker: Awaited<ReturnType<typeof Tesseract.createWorker>>, image: Buffer): Promise<{ text: string; confidence: number }> {
  await worker.setParameters({
    preserve_interword_spaces: "1",
    user_defined_dpi: "300"
  });
  const result = await worker.recognize(image);
  return {
    text: result.data.text.trim(),
    confidence: result.data.confidence
  }
}