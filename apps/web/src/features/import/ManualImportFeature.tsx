import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultMeasurementTypes,
  filterManualGroupTemplates,
  findKnownMeasurement,
  getPreferredUnit,
  manualGroupDefaults,
  normalizeGroupLabel,
  type AppBootstrap,
  type ManualObservationPayload,
  type MeasurementType,
  type UnitSystem
} from "@vitana/shared";
import { api } from "../../api.js";
import { ManualGroupSaveDialog } from "../../components/ManualGroupSaveDialog.js";
import { ManualEntryForm } from "../../pages/ImportPage.js";
import type { ManualMarkerRow } from "../../types.js";
import { todayIsoDate } from "../../utils.js";

export function ManualImportFeature({
  activeProfileId,
  bootstrap,
  units,
  onImported,
  onNotice
}: {
  activeProfileId?: string;
  bootstrap?: AppBootstrap;
  units: UnitSystem;
  onImported: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const requestedMarker = new URLSearchParams(window.location.search).get("marker");
  const requestedMeasurement = requestedMarker
    ? findKnownMeasurement(requestedMarker, defaultMeasurementTypes)
    : undefined;
  const initialObservationGroup = requestedMeasurement
    ? "Lab"
    : readStoredObservationGroup(activeProfileId) ?? "Activity";
  const [busy, setBusy] = useState(false);
  const [collectedAt, setCollectedAt] = useState(todayIsoDate());
  const [observationGroup, setObservationGroup] = useState(initialObservationGroup);
  const [labName, setLabName] = useState("");
  const [rows, setRows] = useState<ManualMarkerRow[]>(() => {
    if (requestedMeasurement) {
      return [createEmptyRow(
        requestedMeasurement.display,
        requestedMeasurement.code,
        "",
        getPreferredUnit(requestedMeasurement, units)
      )];
    }
    return createRowsForGroup(
      initialObservationGroup,
      bootstrap?.measurementTypes?.length ? bootstrap.measurementTypes : defaultMeasurementTypes,
      filterManualGroupTemplates(bootstrap?.manualObservationGroupTemplates ?? []),
      units
    );
  });
  const [saveDialog, setSaveDialog] = useState<{ groupName: string } | null>(null);
  const previousProfileId = useRef(activeProfileId);
  const pendingStoredGroup = useRef(bootstrap ? undefined : initialObservationGroup);

  const measurementTypes = useMemo(() => {
    const types = bootstrap?.measurementTypes?.length ? bootstrap.measurementTypes : defaultMeasurementTypes;
    return [...types].sort((left, right) => left.display.localeCompare(right.display));
  }, [bootstrap?.measurementTypes]);
  const groupTemplates = useMemo(() => {
    return filterManualGroupTemplates(bootstrap?.manualObservationGroupTemplates ?? []);
  }, [bootstrap?.manualObservationGroupTemplates]);
  const observationGroupOptions = useMemo(
    () => [...manualGroupDefaults.map((group) => group.label), ...groupTemplates.map((group) => group.label)],
    [groupTemplates]
  );
  const selectedDefault = manualGroupDefaults.find((group) => group.label === observationGroup);
  const selectedTemplate = groupTemplates.find(
    (group) => group.normalizedLabel === normalizeGroupLabel(observationGroup)
  );
  const allowedMeasurementTypes = useMemo(() => {
    if (selectedDefault) {
      return measurementTypes.filter((type) => type.category === selectedDefault.category);
    }
    if (selectedTemplate) {
      const codes = new Set(selectedTemplate.measurements.map((measurement) => measurement.measurementCode));
      return measurementTypes.filter((type) => codes.has(type.code));
    }
    return measurementTypes;
  }, [measurementTypes, selectedDefault, selectedTemplate]);

  useEffect(() => {
    if (previousProfileId.current !== activeProfileId) {
      previousProfileId.current = activeProfileId;
      pendingStoredGroup.current = undefined;
      if (requestedMeasurement) return;
      const restoredGroup = readStoredObservationGroup(activeProfileId) ?? "Activity";
      setObservationGroup(restoredGroup);
      setRows(createRowsForGroup(restoredGroup, measurementTypes, groupTemplates, units));
      return;
    }
    if (!bootstrap || !pendingStoredGroup.current) return;
    const restoredGroup = pendingStoredGroup.current;
    pendingStoredGroup.current = undefined;
    if (observationGroup === restoredGroup) {
      setRows(createRowsForGroup(restoredGroup, measurementTypes, groupTemplates, units));
    }
  }, [activeProfileId, bootstrap, groupTemplates, measurementTypes, observationGroup, requestedMeasurement, units]);

  function selectObservationGroup(label: string) {
    pendingStoredGroup.current = undefined;
    setObservationGroup(label);
    writeStoredObservationGroup(activeProfileId, label);
    setRows(createRowsForGroup(label, measurementTypes, groupTemplates, units));
  }

  function updateCustomObservationGroup(label: string) {
    pendingStoredGroup.current = undefined;
    setObservationGroup(label);
    writeStoredObservationGroup(activeProfileId, label);
  }

  function updateRow(id: string, patch: Partial<ManualMarkerRow>) {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (patch.marker !== undefined && patch.unit === undefined && !next.unit.trim()) {
        const measurement = findKnownMeasurement(patch.marker, measurementTypes);
        const resolvedUnit = measurement && getPreferredUnit(measurement, units);
        if (resolvedUnit) next.unit = resolvedUnit;
      }
      return next;
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isDefaultGroup = manualGroupDefaults.some((group) => group.label === observationGroup);
    if (isDefaultGroup && rows.length > 1) {
      setSaveDialog({ groupName: "" });
      return;
    }
    await importObservations(observationGroup);
  }

  async function importObservations(groupName: string) {
    setBusy(true);
    try {
      const payload = toManualPayload({ collectedAt, observationGroup: groupName, labName, rows, measurementTypes });
      await api.importManualObservations(payload);
      await onImported();
      resetForm(groupName);
      onNotice("Manual observations imported.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unexpected local error.");
    } finally {
      setBusy(false);
    }
  }

  function resetForm(groupName: string) {
    pendingStoredGroup.current = undefined;
    setCollectedAt(todayIsoDate());
    setObservationGroup(groupName);
    writeStoredObservationGroup(activeProfileId, groupName);
    setLabName("");
    setRows(createRowsForGroup(groupName, measurementTypes, groupTemplates, units, rows));
  }

  return (
    <>
      <ManualEntryForm
        busy={busy}
        observationGroup={observationGroup}
        observationGroupOptions={observationGroupOptions}
        labName={labName}
        collectedAt={collectedAt}
        rows={rows}
        measurementTypes={allowedMeasurementTypes}
        onObservationGroupChange={selectObservationGroup}
        onCustomObservationGroupChange={updateCustomObservationGroup}
        onLabNameChange={setLabName}
        onCollectedAtChange={setCollectedAt}
        onRowChange={updateRow}
        onAddRow={() => setRows((current) => [
          ...current,
          createNextMeasurementRow(current, allowedMeasurementTypes, units)
        ])}
        onRemoveRow={(id) => setRows((current) => current.length <= 1 ? current : current.filter((row) => row.id !== id))}
        units={units}
        onSubmit={submit}
      />
      {saveDialog ? (
        <ManualGroupSaveDialog
          open={true}
          defaultGroup={observationGroup}
          rowCount={rows.length}
          groupName={saveDialog.groupName}
          onGroupNameChange={(groupName) => setSaveDialog({ groupName })}
          onSave={() => {
            const groupName = saveDialog.groupName.trim();
            if (!groupName) return;
            setSaveDialog(null);
            void importObservations(groupName);
          }}
          onSkip={() => {
            setSaveDialog(null);
            void importObservations(observationGroup);
          }}
          onCancel={() => setSaveDialog(null)}
        />
      ) : null}
    </>
  );
}

const observationGroupStoragePrefix = "vitana.manualImport.lastObservationGroup.v1.";
const maximumObservationGroupLength = 160;

function observationGroupStorageKey(profileId?: string) {
  return profileId ? `${observationGroupStoragePrefix}${profileId}` : undefined;
}

function readStoredObservationGroup(profileId?: string) {
  const key = observationGroupStorageKey(profileId);
  if (!key) return undefined;
  try {
    const value = window.localStorage.getItem(key)?.trim();
    return value ? value.slice(0, maximumObservationGroupLength) : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredObservationGroup(profileId: string | undefined, label: string) {
  const key = observationGroupStorageKey(profileId);
  const value = label.trim().slice(0, maximumObservationGroupLength);
  if (!key || !value) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is optional; the import workflow remains usable when it is unavailable.
  }
}

function createRowsForGroup(
  label: string,
  measurementTypes: MeasurementType[],
  groupTemplates: AppBootstrap["manualObservationGroupTemplates"],
  units: UnitSystem,
  fallbackRows?: ManualMarkerRow[]
) {
  const defaultGroup = manualGroupDefaults.find((group) => group.label === label);
  if (defaultGroup) {
    const measurement = measurementTypes.find((type) => type.code === defaultGroup.measurementCode);
    return [createEmptyRow(
      measurement?.display ?? defaultGroup.measurementCode,
      defaultGroup.measurementCode,
      "",
      measurement ? getPreferredUnit(measurement, units) : ""
    )];
  }
  const template = groupTemplates.find(
    (group) => group.normalizedLabel === normalizeGroupLabel(label)
  );
  if (template?.measurements.length) {
    return template.measurements.map((measurement) =>
      createEmptyRow(measurement.marker, measurement.measurementCode, "", measurement.unit));
  }
  return fallbackRows?.length
    ? fallbackRows.map((row) => createEmptyRow(row.marker, row.measurementCode, "", row.unit))
    : [createEmptyRow()];
}

function createNextMeasurementRow(
  rows: ManualMarkerRow[],
  measurementTypes: MeasurementType[],
  units: UnitSystem
) {
  if (!measurementTypes.length) return createEmptyRow();
  const usedCodes = new Set(rows.map((row) => row.measurementCode).filter(Boolean));
  const previousCode = rows.at(-1)?.measurementCode;
  const previousIndex = measurementTypes.findIndex((type) => type.code === previousCode);
  const orderedCandidates = measurementTypes.map((_, offset) =>
    measurementTypes[(previousIndex + offset + 1) % measurementTypes.length]);
  const nextMeasurement = orderedCandidates.find((type) => !usedCodes.has(type.code)) ?? orderedCandidates[0];
  return createEmptyRow(
    nextMeasurement.display,
    nextMeasurement.code,
    "",
    getPreferredUnit(nextMeasurement, units)
  );
}

function toManualPayload({
  collectedAt,
  observationGroup,
  labName,
  rows,
  measurementTypes
}: {
  collectedAt: string;
  observationGroup: string;
  labName: string;
  rows: ManualMarkerRow[];
  measurementTypes: MeasurementType[];
}): ManualObservationPayload {
  if (!collectedAt) throw new Error("Collection date is required.");
  if (!observationGroup.trim()) throw new Error("Observation group is required.");
  const observations = rows.map((row) => {
    const markerName = row.marker.trim();
    if (!markerName && !row.value.trim() && !row.unit.trim()) return undefined;
    const value = Number.parseFloat(row.value);
    if (!Number.isFinite(value)) throw new Error(`Enter a numeric value for ${markerName || "all rows"}.`);
    const known = findKnownMeasurement(row.measurementCode?.trim() || "", measurementTypes) ??
      findKnownMeasurement(markerName, measurementTypes);
    return {
      measurementName: markerName || known?.display,
      measurementCode: row.measurementCode?.trim() || known?.code,
      value,
      unit: row.unit.trim() || known?.canonicalUnit
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
  if (observations.length === 0) throw new Error("Enter at least one observation row before import.");
  return {
    observedAt: collectedAt,
    label: observationGroup.trim(),
    sourceName: labName.trim() || undefined,
    observations
  };
}

function createEmptyRow(marker = "", measurementCode = "", value = "", unit = ""): ManualMarkerRow {
  return { id: globalThis.crypto.randomUUID(), marker, measurementCode, value, unit };
}
