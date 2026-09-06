import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const worker = {
    setParameters: vi.fn(),
    recognize: vi.fn(async (image: Buffer) => ({
      data: {
        text: `Page ${image[0]}`,
        confidence: 90
      }
    })),
    terminate: vi.fn()
  };
  return {
    getText: vi.fn(async () => ({
      text: Array.from({ length: 20 }, (_, index) => `-- ${index + 1} of 20 --`).join("\n"),
      total: 20
    })),
    getScreenshot: vi.fn(async () => ({
      pages: Array.from({ length: 20 }, (_, index) => ({
        pageNumber: index + 1,
        data: new Uint8Array([index + 1])
      }))
    })),
    destroy: vi.fn(),
    createWorker: vi.fn(async () => worker),
    createBodyCompositionDateImage: vi.fn(async (image: Buffer) => image.toString() === "needs-date" ? Buffer.from("date-image") : undefined),
    worker
  };
});

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = mocks.getText;
    getScreenshot = mocks.getScreenshot;
    destroy = mocks.destroy;
  }
}));

vi.mock("tesseract.js", () => ({
  default: {
    createWorker: mocks.createWorker
  }
}));

vi.mock("../bodyCompositionDocumentImage.js", () => ({
  createBodyCompositionDateImage: mocks.createBodyCompositionDateImage
}));

import { extractBodyCompositionText } from "../bodyCompositionExtract.js";

describe("extractBodyCompositionText", () => {
  it("OCRs every page when a PDF contains only page markers as embedded text", async () => {
    const result = await extractBodyCompositionText(Buffer.from("pdf"), "application/pdf");

    expect(mocks.getScreenshot).toHaveBeenCalledWith({ scale: 2, first: 20, imageBuffer: true });
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.worker.recognize).toHaveBeenCalledTimes(20);
    expect(result.text).toContain("Page 1");
    expect(result.text).toContain("Page 20");
    expect(result.diagnostics.filter((item) => item.startsWith("PDF page"))).toHaveLength(20);
  });

  it("uses an isolated document header only when the initial image OCR has no report date", async () => {
    mocks.worker.recognize.mockImplementationOnce(async () => ({ data: { text: "WEIGHT 73.6kg", confidence: 42 } }));
    mocks.worker.recognize.mockImplementationOnce(async () => ({ data: { text: "25/JUL/2026 13:26", confidence: 71 } }));

    const result = await extractBodyCompositionText(Buffer.from("needs-date"), "image/jpeg");

    expect(mocks.createBodyCompositionDateImage).toHaveBeenCalledWith(Buffer.from("needs-date"), "image/jpeg");
    expect(result.text).toContain("25/JUL/2026");
    expect(result.text).toContain("WEIGHT 73.6kg");
    expect(result.diagnostics).toContain("Recovered the report date from an isolated document header.");
  });

  it("does not generate a document header crop when initial image OCR already has a report date", async () => {
    mocks.worker.recognize.mockImplementationOnce(async () => ({ data: { text: "25/JUL/2026 13:26", confidence: 90 } }));

    await extractBodyCompositionText(Buffer.from("already-dated"), "image/jpeg");

    expect(mocks.createBodyCompositionDateImage).not.toHaveBeenCalledWith(Buffer.from("already-dated"), "image/jpeg");
  });

  it("does not run report-header OCR for an image with no recognized measurements", async () => {
    mocks.worker.recognize.mockImplementationOnce(async () => ({ data: { text: "A photo of a sunset", confidence: 87 } }));

    const result = await extractBodyCompositionText(Buffer.from("not-a-report"), "image/jpeg");

    expect(mocks.createBodyCompositionDateImage).not.toHaveBeenCalledWith(Buffer.from("not-a-report"), "image/jpeg");
    expect(result.diagnostics).toContain("Skipped report-header OCR because the image did not contain a recognized measurement.");
  });
});