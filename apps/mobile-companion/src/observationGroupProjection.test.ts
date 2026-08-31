import { describe, expect, it } from "vitest";
import {
  defaultMeasurementTypes,
  type DataSource,
  type Observation,
  type ObservationGroup,
  type PersonalReferenceRange,
  type SourceImport
} from "@vitana/shared";
import { projectObservationGroup } from "./observationGroupProjection";

const group: ObservationGroup = {
  id: "group-1",
  kind: "body_composition_report",
  label: "Body composition",
  sourceId: "source-1",
  importId: "import-1",
  collectedAt: "2026-08-20T09:00:00.000Z"
};

const source: DataSource = {
  id: "source-1",
  sourceKind: "body-composition-report",
  label: "Smart scale",
  importId: "import-1",
  createdAt: "2026-08-20T09:01:00.000Z"
};

const sourceImport: SourceImport = {
  id: "import-1",
  sourceKind: "body-composition-report",
  fileName: "body-report.pdf",
  importedAt: "2026-08-20T09:01:00.000Z",
  parserVersion: "test",
  checksum: "checksum",
  rowCount: 2,
  status: "processed",
  diagnostics: []
};

const personalRange: PersonalReferenceRange = {
  measurementCode: "weight",
  normalLow: 150,
  normalHigh: 160,
  unit: "lb",
  updatedAt: "2026-08-20T09:02:00.000Z"
};

describe("observation group projection", () => {
  it("converts values, applies personal ranges, preserves provenance, and orders readings", () => {
    const observations: Observation[] = [
      observation("later", "2026-08-20T09:00:01.000Z", 60),
      observation("earlier", "2026-08-20T09:00:00.000Z", 70)
    ];

    const result = projectObservationGroup({
      group,
      observations,
      profile: { subjectKind: "adult", units: "imperial" },
      measurementTypes: defaultMeasurementTypes,
      personalReferenceRanges: [personalRange],
      source,
      sourceImport
    });

    expect(result).toMatchObject({
      id: "group-1",
      source: {
        kind: "body-composition-report",
        label: "Smart scale",
        importFileName: "body-report.pdf",
        importedAt: "2026-08-20T09:01:00.000Z"
      },
      editable: true
    });
    expect(result.observations.map((entry) => entry.id)).toEqual(["earlier", "later"]);
    expect(result.observations[0]).toMatchObject({
      displayName: "Weight",
      unit: "lb",
      referenceRange: { low: 150, high: 160, unit: "lb" },
      status: "normal"
    });
    expect(result.observations[0]!.value).toBeCloseTo(154.32, 2);
    expect(result.observations[1]).toMatchObject({ status: "low" });
  });

  it("uses safe metadata fallbacks when source records are unavailable", () => {
    const result = projectObservationGroup({
      group: { ...group, sourceId: undefined, importId: undefined },
      observations: [observation("reading", "2026-08-20T09:00:00.000Z", 70)],
      profile: { subjectKind: "adult", units: "metric" },
      measurementTypes: defaultMeasurementTypes
    });

    expect(result.source).toEqual({
      kind: "derived",
      label: "Unknown source",
      importFileName: undefined,
      importedAt: undefined
    });
    expect(result).toMatchObject({ editable: false });
  });
});

function observation(id: string, observedAt: string, value: number): Observation {
  return {
    id,
    measurementCode: "weight",
    observedAt,
    value,
    unit: "kg",
    sourceId: "source-1",
    observationGroupId: "group-1"
  };
}
