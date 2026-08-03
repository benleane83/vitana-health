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
});