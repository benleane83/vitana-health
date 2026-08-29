import { once } from "node:events";
import { PassThrough, type Readable } from "node:stream";
import { Zip, ZipDeflate } from "fflate";
import type { ProfileExportCollection, ProfileRepository } from "./storage/profileRepository.js";

const PAGE_SIZE = 1_000;
const EXCEL_MAX_ROWS = 1_048_576;
const EXCEL_MAX_CELL_CHARACTERS = 32_767;
const textEncoder = new TextEncoder();

type ExportRecord = object;
type CellValue = string | number | boolean | null | undefined | object;

interface Column {
  header: string;
  value: (record: ExportRecord) => CellValue;
  width?: number;
}

interface CollectionSheet {
  collection: ProfileExportCollection;
  name: string;
  columns: readonly Column[];
}

interface WorkbookSheet {
  name: string;
  path: string;
}

export interface HealthDataWorkbookOptions {
  createdAt?: string;
  maxRowsPerSheet?: number;
  signal?: AbortSignal;
}

export type ProfileExportReader = Pick<ProfileRepository, "profileExportMetadata" | "profileExportPage">;

export class XlsxCellTooLargeError extends Error {
  readonly code = "XLSX_CELL_TOO_LARGE";

  constructor(sheet: string, column: string) {
    super(`The ${column} value in ${sheet} exceeds Excel's cell-size limit.`);
    this.name = "XlsxCellTooLargeError";
  }
}

const key = (property: string, header = property, width?: number): Column => ({
  header,
  width,
  value: (record) => (record as Record<string, unknown>)[property] as CellValue
});

const collectionSheets: readonly CollectionSheet[] = [
  {
    collection: "observations",
    name: "Observations",
    columns: [
      key("id", "ID", 26), key("measurementCode", "Measurement code", 24),
      key("observedAt", "Observed at", 25), key("effectiveStart", "Effective start", 25),
      key("effectiveEnd", "Effective end", 25), key("value", "Value", 14), key("unit", "Unit", 14),
      key("sourceId", "Source ID", 24), key("observationGroupId", "Observation group ID", 26),
      key("deviceId", "Device ID", 24), key("note", "Note", 40)
    ]
  },
  {
    collection: "observationGroups",
    name: "Observation groups",
    columns: [
      key("id", "ID", 26), key("kind", "Kind", 22), key("label", "Label", 30), key("sourceId", "Source ID", 24),
      key("importId", "Import ID", 24), key("startAt", "Start at", 25), key("endAt", "End at", 25),
      key("collectedAt", "Collected at", 25), key("metadata", "Metadata (JSON)", 45)
    ]
  },
  {
    collection: "timeSeriesSamples",
    name: "Time series samples",
    columns: [
      key("id", "ID", 26), key("measurementCode", "Measurement code", 24), key("startAt", "Start at", 25),
      key("endAt", "End at", 25), key("value", "Value", 14), key("unit", "Unit", 14),
      key("sourceId", "Source ID", 24), key("deviceId", "Device ID", 24)
    ]
  },
  {
    collection: "measurementAggregates",
    name: "Measurement aggregates",
    columns: [
      key("id", "ID", 26), key("measurementCode", "Measurement code", 24), key("granularity", "Granularity", 16),
      key("startAt", "Start at", 25), key("endAt", "End at", 25), key("average", "Average", 14),
      key("minimum", "Minimum", 14), key("maximum", "Maximum", 14), key("count", "Count", 12),
      key("unit", "Unit", 14), key("sourceId", "Source ID", 24), key("calendarDate", "Calendar date", 16)
    ]
  },
  {
    collection: "activitySessions",
    name: "Activity sessions",
    columns: [
      key("id", "ID", 26), key("activityType", "Activity type", 22), key("startAt", "Start at", 25),
      key("endAt", "End at", 25), key("durationMinutes", "Duration (minutes)", 18),
      key("energyKcal", "Energy (kcal)", 16), key("distanceMeters", "Distance (meters)", 18),
      key("sourceId", "Source ID", 24)
    ]
  },
  {
    collection: "healthEvents",
    name: "Health events",
    columns: [
      key("id", "ID", 26), key("kind", "Kind", 22), key("status", "Status", 18), key("occurredAt", "Occurred at", 25),
      key("source", "Source", 22), key("provider", "Provider", 28), key("notes", "Notes", 40),
      key("metadata", "Metadata (JSON)", 45), key("immunization", "Immunization (JSON)", 45),
      key("medicationAdministration", "Medication administration (JSON)", 45)
    ]
  },
  {
    collection: "careItems",
    name: "Care items",
    columns: [
      key("id", "ID", 26), key("kind", "Kind", 20), key("code", "Code", 20), key("title", "Title", 32),
      key("dueStart", "Due start", 25), key("reminderAt", "Reminder at", 25), key("priority", "Priority", 14),
      key("status", "Status", 16), key("scheduleProvenance", "Schedule provenance", 24),
      key("scheduleVersion", "Schedule version", 18), key("notes", "Notes", 40),
      key("completedHealthEventId", "Completed health event ID", 28), key("completedAt", "Completed at", 25)
    ]
  },
  {
    collection: "measurementTypes",
    name: "Measurement types",
    columns: [
      key("code", "Code", 24), key("display", "Display", 28), key("description", "Description", 40),
      key("category", "Category", 16), key("kind", "Kind", 18), key("canonicalUnit", "Canonical unit", 18),
      key("aliases", "Aliases (JSON)", 36), key("preferredUnits", "Preferred units (JSON)", 32),
      key("unitAliases", "Unit aliases (JSON)", 36), key("fhirCode", "FHIR code", 20), key("loincCode", "LOINC code", 20),
      key("openMHealthSchema", "Open mHealth schema", 28), key("normalLow", "Normal low", 14),
      key("normalHigh", "Normal high", 14), key("referenceRanges", "Reference ranges (JSON)", 45),
      key("aggregation", "Aggregation", 16)
    ]
  },
  {
    collection: "personalReferenceRanges",
    name: "Personal ranges",
    columns: [
      key("measurementCode", "Measurement code", 24), key("normalLow", "Normal low", 14),
      key("normalHigh", "Normal high", 14), key("optimalLow", "Optimal low", 14),
      key("optimalHigh", "Optimal high", 14), key("unit", "Unit", 14), key("updatedAt", "Updated at", 25)
    ]
  },
  {
    collection: "pinnedMeasurements",
    name: "Pinned measurements",
    columns: [key("measurementCode", "Measurement code", 24), key("pinnedAt", "Pinned at", 25)]
  },
  {
    collection: "dataSources",
    name: "Data sources",
    columns: [
      key("id", "ID", 26), key("sourceKind", "Source kind", 24), key("label", "Label", 30),
      key("importId", "Import ID", 24), key("createdAt", "Created at", 25)
    ]
  },
  {
    collection: "devices",
    name: "Devices",
    columns: [
      key("id", "ID", 26), key("label", "Label", 28), key("manufacturer", "Manufacturer", 24),
      key("model", "Model", 24), key("sourceId", "Source ID", 24)
    ]
  },
  {
    collection: "sourceImports",
    name: "Imports",
    columns: [
      key("id", "ID", 26), key("sourceKind", "Source kind", 24), key("fileName", "File name", 34),
      key("importedAt", "Imported at", 25), key("parserVersion", "Parser version", 18),
      key("checksum", "Checksum", 45), key("rowCount", "Row count", 14), key("status", "Status", 18),
      key("diagnostics", "Diagnostics (JSON)", 45)
    ]
  },
  {
    collection: "insights",
    name: "Insights",
    columns: [
      key("id", "ID", 26), key("createdAt", "Created at", 25), key("title", "Title", 32), key("body", "Body", 60),
      key("evidence", "Evidence (JSON)", 45), key("confidence", "Confidence", 16), key("model", "Model", 24),
      key("safetyNotice", "Safety notice", 50)
    ]
  }
];

export function createHealthDataWorkbookStream(
  repository: ProfileExportReader,
  options: HealthDataWorkbookOptions = {}
): Readable {
  const output = new PassThrough({ highWaterMark: 256 * 1024 });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      output.destroy(error);
      return;
    }
    if (chunk.length > 0) output.write(Buffer.from(chunk));
    if (final) output.end();
  });

  void produceWorkbook(zip, output, repository, options).catch((error) => {
    zip.terminate();
    output.destroy(error instanceof Error ? error : new Error("Failed to create health data workbook."));
  });
  return output;
}

async function produceWorkbook(
  zip: Zip,
  output: PassThrough,
  repository: ProfileExportReader,
  options: HealthDataWorkbookOptions
): Promise<void> {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const maxRowsPerSheet = options.maxRowsPerSheet ?? EXCEL_MAX_ROWS;
  if (!Number.isInteger(maxRowsPerSheet) || maxRowsPerSheet < 2 || maxRowsPerSheet > EXCEL_MAX_ROWS) {
    throw new Error("XLSX rows per sheet must be between 2 and 1,048,576.");
  }

  throwIfAborted(options.signal);
  const metadata = await repository.profileExportMetadata();
  const sheets: WorkbookSheet[] = [];

  await addRowsSheet(zip, output, sheets, "Overview", [
    ["Field", "Value"],
    ["Exported at", createdAt],
    ["Profile", metadata.profile.displayName],
    ["Profile ID", metadata.profile.id],
    ["Export format version", metadata.schemaVersion],
    ["Scope", "Current profile only"],
    ["Privacy", "Unencrypted workbook containing sensitive health data"],
    ["Excluded", "Audit logs, profile photo bytes, raw imported files, and raw source payloads"]
  ], [28, 85], options.signal);

  const profileColumns = [
    key("id", "ID", 26), key("displayName", "Display name", 28), key("subjectKind", "Subject kind", 16),
    key("setupStatus", "Setup status", 16), key("birthDate", "Birth date", 16), key("sex", "Sex", 16),
    key("bloodType", "Blood type", 16), key("heightCm", "Height (cm)", 14), key("goalSummary", "Goal summary", 45),
    key("cloudAiConsent", "Cloud AI consent (JSON)", 40), key("pet", "Pet details (JSON)", 40),
    key("units", "Units", 14), key("updatedAt", "Updated at", 25)
  ];
  await addRecordSheet(zip, output, sheets, "Profile", profileColumns, [metadata.profile], options.signal);

  for (const descriptor of collectionSheets) {
    await addCollectionSheets(
      zip,
      output,
      sheets,
      repository,
      descriptor,
      maxRowsPerSheet,
      options.signal
    );
  }

  await addTextEntry(zip, output, "[Content_Types].xml", contentTypesXml(sheets.length), options.signal);
  await addTextEntry(zip, output, "_rels/.rels", packageRelationshipsXml(), options.signal);
  await addTextEntry(zip, output, "docProps/core.xml", corePropertiesXml(createdAt), options.signal);
  await addTextEntry(zip, output, "docProps/app.xml", appPropertiesXml(), options.signal);
  await addTextEntry(zip, output, "xl/workbook.xml", workbookXml(sheets), options.signal);
  await addTextEntry(zip, output, "xl/_rels/workbook.xml.rels", workbookRelationshipsXml(sheets.length), options.signal);
  await addTextEntry(zip, output, "xl/styles.xml", stylesXml(), options.signal);
  throwIfAborted(options.signal);
  zip.end();
}

async function addCollectionSheets(
  zip: Zip,
  output: PassThrough,
  sheets: WorkbookSheet[],
  repository: ProfileExportReader,
  descriptor: CollectionSheet,
  maxRowsPerSheet: number,
  signal?: AbortSignal
): Promise<void> {
  let part = 1;
  let rowNumber = 1;
  let file = startWorksheet(zip, sheets, continuationName(descriptor.name, part), descriptor.columns);

  const finishCurrent = async () => {
    file.push(encode(worksheetFooter(descriptor.columns.length, rowNumber)), true);
    await waitForOutput(output, signal);
  };

  let offset = 0;
  while (true) {
    throwIfAborted(signal);
    const page = await repository.profileExportPage(descriptor.collection, offset, PAGE_SIZE);
    for (const item of page.items) {
      if (!isRecord(item)) throw new Error(`Profile export collection ${descriptor.collection} returned a non-object row.`);
      if (rowNumber >= maxRowsPerSheet) {
        await finishCurrent();
        part += 1;
        rowNumber = 1;
        file = startWorksheet(zip, sheets, continuationName(descriptor.name, part), descriptor.columns);
      }
      rowNumber += 1;
      file.push(encode(recordRowXml(descriptor.name, descriptor.columns, item, rowNumber)));
    }
    offset += page.items.length;
    await waitForOutput(output, signal);
    if (page.done) break;
    if (page.items.length === 0) throw new Error(`Profile export page for ${descriptor.collection} made no progress.`);
  }
  await finishCurrent();
}

async function addRecordSheet(
  zip: Zip,
  output: PassThrough,
  sheets: WorkbookSheet[],
  name: string,
  columns: readonly Column[],
  records: readonly ExportRecord[],
  signal?: AbortSignal
): Promise<void> {
  const file = startWorksheet(zip, sheets, name, columns);
  records.forEach((record, index) => file.push(encode(recordRowXml(name, columns, record, index + 2))));
  file.push(encode(worksheetFooter(columns.length, records.length + 1)), true);
  await waitForOutput(output, signal);
}

async function addRowsSheet(
  zip: Zip,
  output: PassThrough,
  sheets: WorkbookSheet[],
  name: string,
  rows: readonly (readonly CellValue[])[],
  widths: readonly number[],
  signal?: AbortSignal
): Promise<void> {
  const columns = widths.map((width, index) => ({ header: String(index), width, value: () => undefined }));
  const path = `xl/worksheets/sheet${sheets.length + 1}.xml`;
  sheets.push({ name, path });
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  file.push(encode(worksheetHeader(columns)));
  rows.forEach((row, rowIndex) => file.push(encode(valuesRowXml(name, row, rowIndex + 1, rowIndex === 0))));
  file.push(encode(worksheetFooter(columns.length, rows.length)), true);
  await waitForOutput(output, signal);
}

function startWorksheet(
  zip: Zip,
  sheets: WorkbookSheet[],
  name: string,
  columns: readonly Column[]
): ZipDeflate {
  const path = `xl/worksheets/sheet${sheets.length + 1}.xml`;
  sheets.push({ name, path });
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  file.push(encode(worksheetHeader(columns)));
  file.push(encode(valuesRowXml(name, columns.map((column) => column.header), 1, true)));
  return file;
}

async function addTextEntry(
  zip: Zip,
  output: PassThrough,
  name: string,
  text: string,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal);
  const file = new ZipDeflate(name, { level: 6 });
  zip.add(file);
  file.push(encode(text), true);
  await waitForOutput(output, signal);
}

function worksheetHeader(columns: readonly { width?: number }[]): string {
  const columnXml = columns.map((column, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 20}" customWidth="1"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${columnXml}</cols><sheetData>`;
}

function worksheetFooter(columnCount: number, rowCount: number): string {
  return `</sheetData><autoFilter ref="A1:${columnName(columnCount)}${Math.max(1, rowCount)}"/></worksheet>`;
}

function recordRowXml(sheet: string, columns: readonly Column[], record: ExportRecord, rowNumber: number): string {
  return valuesRowXml(sheet, columns.map((column) => column.value(record)), rowNumber, false, columns);
}

function valuesRowXml(
  sheet: string,
  values: readonly CellValue[],
  rowNumber: number,
  header: boolean,
  columns?: readonly Column[]
): string {
  const cells = values.map((value, index) => cellXml(
    sheet,
    columns?.[index]?.header ?? `Column ${index + 1}`,
    value,
    `${columnName(index + 1)}${rowNumber}`,
    header
  )).join("");
  return `<row r="${rowNumber}">${cells}</row>`;
}

function cellXml(sheet: string, column: string, value: CellValue, reference: string, header: boolean): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"${header ? ` s="1"` : ""}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}" t="b"${header ? ` s="1"` : ""}><v>${value ? 1 : 0}</v></c>`;
  }
  const text = typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : canonicalJson(value);
  if ([...text].length > EXCEL_MAX_CELL_CHARACTERS) throw new XlsxCellTooLargeError(sheet, column);
  return `<c r="${reference}" t="inlineStr"${header ? ` s="1"` : ""}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function canonicalJson(value: object): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJsonValue(entry)).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([keyName, entry]) => `${JSON.stringify(keyName)}:${canonicalJsonValue(entry)}`)
    .join(",")}}`;
}

function canonicalJsonValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`;
  if (value && typeof value === "object") return canonicalJson(value);
  return JSON.stringify(value);
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "\uFFFD")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let value = index;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function continuationName(name: string, part: number): string {
  if (part === 1) return name.slice(0, 31);
  const suffix = ` ${part}`;
  return `${name.slice(0, 31 - suffix.length)}${suffix}`;
}

function encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function isRecord(value: unknown): value is ExportRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Health data export was cancelled.");
  error.name = "AbortError";
  throw error;
}

async function waitForOutput(output: PassThrough, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (output.destroyed) throw new Error("Health data export output closed unexpectedly.");
  if (output.writableNeedDrain) await once(output, "drain");
  throwIfAborted(signal);
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `${sheets}</Types>`;
}

function packageRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;
}

function workbookXml(sheets: readonly WorkbookSheet[]): string {
  const sheetXml = sheets.map((sheet, index) =>
    `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheetXml}</sheets></workbook>`;
}

function workbookRelationshipsXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}` +
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Arial"/><family val="2"/></font>` +
    `<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/><family val="2"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">` +
    `<alignment horizontal="center" vertical="center"/></xf></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
}

function corePropertiesXml(createdAt: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:creator>Vitana Health</dc:creator><cp:lastModifiedBy>Vitana Health</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${xml(createdAt)}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${xml(createdAt)}</dcterms:modified>` +
    `<dc:title>Health data export</dc:title></cp:coreProperties>`;
}

function appPropertiesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>Vitana Health</Application><AppVersion>1.0</AppVersion></Properties>`;
}
