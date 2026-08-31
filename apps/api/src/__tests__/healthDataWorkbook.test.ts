import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { EXPORT_FORMAT_VERSION, type Profile } from "@vitana/shared";
import {
  createHealthDataWorkbookStream,
  XlsxCellTooLargeError,
  type ProfileExportReader
} from "../healthDataWorkbook.js";
import type { ProfileExportCollection } from "../storage/profileRepository.js";

const profile: Profile = {
  id: "test-profile",
  displayName: "Test & Profile",
  subjectKind: "adult",
  setupStatus: "complete",
  units: "metric",
  updatedAt: "2026-03-01T12:00:00.000Z"
};

function createReader(
  collections: Partial<Record<ProfileExportCollection, unknown[]>> = {}
): ProfileExportReader & { profileExportPage: ReturnType<typeof vi.fn> } {
  return {
    profileExportMetadata: vi.fn().mockResolvedValue({
      schemaVersion: EXPORT_FORMAT_VERSION,
      profile
    }),
    profileExportPage: vi.fn(async (collection: ProfileExportCollection, offset: number, limit: number) => {
      const values = collections[collection] ?? [];
      const items = values.slice(offset, offset + limit);
      return { items, done: offset + items.length >= values.length };
    })
  };
}

async function workbookBytes(reader: ProfileExportReader, options = {}): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createHealthDataWorkbookStream(reader, options)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function textEntries(bytes: Buffer): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, value]) => [name, Buffer.from(value).toString("utf8")])
  );
}

describe("health data workbook", () => {
  it("creates a valid minimal OOXML package with profile and header-only collection sheets", async () => {
    const entries = textEntries(await workbookBytes(createReader(), {
      createdAt: "2026-03-02T01:02:03.000Z"
    }));

    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml"
    ]));
    expect(entries["xl/workbook.xml"]).toContain('name="Overview"');
    expect(entries["xl/workbook.xml"]).toContain('name="Profile"');
    expect(entries["xl/workbook.xml"]).toContain('name="Observations"');
    expect(entries["xl/styles.xml"]).toContain('<name val="Arial"/>');
    expect(entries["xl/worksheets/sheet1.xml"]).toContain("Current profile only");
    expect(entries["xl/worksheets/sheet2.xml"]).toContain("Test &amp; Profile");
    expect(entries["xl/worksheets/sheet3.xml"]).toContain("Measurement code");
  });

  it("escapes XML, writes native values, canonicalizes JSON, and omits raw payloads", async () => {
    const entries = textEntries(await workbookBytes(createReader({
      observations: [{
        id: "obs-1",
        measurementCode: "heart-rate",
        value: 72.5,
        note: "A < B & C",
        sourceJson: "RAW-SOURCE-SECRET"
      }],
      healthEvents: [{
        id: "event-1",
        metadata: { z: true, a: [2, 1] }
      }],
      sourceImports: [{
        id: "import-1",
        fileName: "health.zip",
        rawContent: "RAW-FILE-SECRET"
      }]
    })));

    const allXml = Object.values(entries).join("\n");
    expect(allXml).toContain("<v>72.5</v>");
    expect(allXml).toContain("A &lt; B &amp; C");
    expect(allXml).toContain("{&quot;a&quot;:[2,1],&quot;z&quot;:true}");
    expect(allXml).not.toContain("RAW-SOURCE-SECRET");
    expect(allXml).not.toContain("RAW-FILE-SECRET");
    expect(allXml).not.toContain("Audit events");
  });

  it("exports medications with active ingredients and blank optional dose fields", async () => {
    const entries = textEntries(await workbookBytes(createReader({
      medications: [{
        id: "med-1",
        name: "Metformin",
        activeIngredient: "metformin hydrochloride",
        startDate: "2026-01-15",
        createdAt: "2026-01-15T00:00:00.000Z",
        updatedAt: "2026-01-15T00:00:00.000Z"
      }]
    })));
    const allXml = Object.values(entries).join("\n");

    expect(entries["xl/workbook.xml"]).toContain('name="Medications"');
    expect(allXml).toContain("Active Ingredient(s)");
    expect(allXml).toContain("Metformin");
    expect(allXml).toContain("metformin hydrochloride");
    expect(allXml).not.toContain("undefined");
  });

  it("uses bounded pages and creates continuation sheets at the configured row limit", async () => {
    const observations = Array.from({ length: 1_002 }, (_, index) => ({
      id: `obs-${index}`,
      measurementCode: "steps",
      value: index
    }));
    const reader = createReader({ observations });
    const entries = textEntries(await workbookBytes(reader, { maxRowsPerSheet: 1_000 }));

    expect(reader.profileExportPage).toHaveBeenCalledWith("observations", 0, 1_000);
    expect(reader.profileExportPage).toHaveBeenCalledWith("observations", 1_000, 1_000);
    expect(entries["xl/workbook.xml"]).toContain('name="Observations 2"');
  });

  it("stops before paging when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const reader = createReader();

    await expect(workbookBytes(reader, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(reader.profileExportPage).not.toHaveBeenCalled();
  });

  it("rejects cells that exceed Excel's text limit", async () => {
    const reader = createReader({
      insights: [{ id: "insight-1", body: "x".repeat(32_768) }]
    });

    await expect(workbookBytes(reader)).rejects.toBeInstanceOf(XlsxCellTooLargeError);
  });
});
