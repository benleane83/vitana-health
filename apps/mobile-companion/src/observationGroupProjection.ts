import {
  classifyValueWithRange,
  isObservationSourceEditable,
  resolveReferenceRange,
  toPreferredMeasurementValue,
  type DataSource,
  type MeasurementType,
  type Observation,
  type ObservationGroup,
  type ObservationGroupDetail,
  type PersonalReferenceRange,
  type Profile,
  type SourceImport
} from "@vitana/shared";

export interface ObservationGroupProjectionInput {
  group: ObservationGroup;
  observations: Observation[];
  profile: Pick<Profile, "subjectKind" | "units">;
  measurementTypes: MeasurementType[];
  personalReferenceRanges?: PersonalReferenceRange[];
  source?: DataSource;
  sourceImport?: SourceImport;
}

export function projectObservationGroup({
  group,
  observations,
  profile,
  measurementTypes,
  personalReferenceRanges = [],
  source,
  sourceImport
}: ObservationGroupProjectionInput): ObservationGroupDetail {
  const types = new Map(measurementTypes.map((entry) => [entry.code, entry]));
  const ranges = new Map(personalReferenceRanges.map((entry) => [entry.measurementCode, entry]));
  const sourceKind = source?.sourceKind ?? sourceImport?.sourceKind ?? "derived";
  const editable = isObservationSourceEditable(sourceKind);

  return {
    id: group.id,
    kind: group.kind,
    label: group.label,
    collectedAt: group.collectedAt,
    source: {
      kind: sourceKind,
      label: source?.label ?? group.sourceId ?? "Unknown source",
      importFileName: sourceImport?.fileName,
      importedAt: sourceImport?.importedAt
    },
    editable,
    readOnlyReason: editable
      ? undefined
      : "This group is synchronized from another source and cannot be edited here.",
    observations: [...observations]
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id))
      .map((observation) => {
        const measurementType = types.get(observation.measurementCode);
        const displayed = measurementType
          ? toPreferredMeasurementValue(
              observation.value,
              observation.unit,
              measurementType,
              profile.units
            )
          : { value: observation.value, unit: observation.unit };
        const referenceRange = measurementType
          ? resolveReferenceRange(
              measurementType,
              displayed.unit,
              ranges.get(observation.measurementCode),
              profile.subjectKind ?? "adult"
            ).effective
          : undefined;
        return {
          id: observation.id,
          measurementCode: observation.measurementCode,
          displayName: measurementType?.display ?? observation.measurementCode,
          observedAt: observation.observedAt,
          value: displayed.value,
          unit: displayed.unit,
          note: observation.note,
          referenceRange,
          status: classifyValueWithRange(displayed.value, referenceRange)
        };
      })
  };
}
