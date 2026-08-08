import { useEffect, useMemo, useState } from "react";
import { type MeasurementType } from "@vitana/shared";
import { useCombobox } from "downshift";
import { measurementCategoryLabels } from "../utils.js";

type MeasurementItem = {
  kind: "measurement";
  measurement: MeasurementType;
  matchedAlias?: string;
};

type CustomItem = {
  kind: "custom";
};

type ComboboxItem = MeasurementItem | CustomItem;

const customItem: CustomItem = { kind: "custom" };

export function MeasurementCombobox({
  id,
  ariaLabel,
  measurementTypes,
  selectedCode,
  selectedLabel,
  onSelect,
  onSelectCustom,
  customLabel = "Use a custom measurement"
}: {
  id: string;
  ariaLabel: string;
  measurementTypes: MeasurementType[];
  selectedCode: string;
  selectedLabel?: string;
  onSelect: (measurement: MeasurementType) => void;
  onSelectCustom?: () => void;
  customLabel?: string;
}) {
  const selectedMeasurement = measurementTypes.find((type) => type.code === selectedCode);
  const selectedDisplay = selectedMeasurement?.display ?? selectedLabel ?? "";
  const [inputValue, setInputValue] = useState(selectedDisplay);
  const measurementItems = useMemo(
    () => findMeasurementMatches(measurementTypes, inputValue, selectedDisplay),
    [inputValue, measurementTypes, selectedDisplay]
  );
  const items = useMemo<ComboboxItem[]>(
    () => onSelectCustom ? [...measurementItems, customItem] : measurementItems,
    [measurementItems, onSelectCustom]
  );
  const selectedItem = useMemo<MeasurementItem | null>(() => selectedMeasurement
    ? { kind: "measurement", measurement: selectedMeasurement }
    : null, [selectedMeasurement]);

  useEffect(() => {
    setInputValue(selectedDisplay);
  }, [selectedCode, selectedDisplay]);

  const {
    getInputProps,
    getItemProps,
    getMenuProps,
    getToggleButtonProps,
    highlightedIndex,
    isOpen
  } = useCombobox<ComboboxItem>({
    id,
    items,
    inputValue,
    selectedItem,
    itemToString: (item) => item?.kind === "measurement" ? item.measurement.display : "",
    onInputValueChange: ({ inputValue: nextInputValue }) => setInputValue(nextInputValue ?? ""),
    onIsOpenChange: ({ isOpen: nextIsOpen }) => {
      if (!nextIsOpen) setInputValue(selectedDisplay);
    },
    onSelectedItemChange: ({ selectedItem }) => {
      if (!selectedItem) return;
      if (selectedItem.kind === "custom") {
        onSelectCustom?.();
        return;
      }
      setInputValue(selectedItem.measurement.display);
      onSelect(selectedItem.measurement);
    }
  });

  return (
    <div className="measurement-combobox">
      <div className="measurement-combobox-control">
        <input
          {...getInputProps({
            id,
            "aria-label": ariaLabel,
            placeholder: "Search measurements",
            onFocus: (event) => event.currentTarget.select()
          })}
        />
        <button
          {...getToggleButtonProps({
            type: "button",
            "aria-label": isOpen ? "Close measurement choices" : "Open measurement choices"
          })}
          className="measurement-combobox-toggle"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </button>
      </div>
      <ul {...getMenuProps()} className={`measurement-combobox-menu${isOpen ? " is-open" : ""}`}>
        {isOpen && measurementItems.length === 0 ? (
          <li className="measurement-combobox-empty">No known measurements match.</li>
        ) : null}
        {isOpen ? items.map((item, index) => (
          <li
            {...getItemProps({ item, index })}
            className={`measurement-combobox-option${highlightedIndex === index ? " is-highlighted" : ""}${item.kind === "custom" ? " is-custom" : ""}`}
            key={item.kind === "custom" ? "custom" : item.measurement.code}
          >
            {item.kind === "custom" ? (
              <span>{customLabel}</span>
            ) : (
              <>
                <span>{item.measurement.display}</span>
                <small>
                  {item.matchedAlias ? `Matches “${item.matchedAlias}” · ` : ""}
                  {measurementCategoryLabels[item.measurement.category]}
                </small>
              </>
            )}
          </li>
        )) : null}
      </ul>
    </div>
  );
}

function findMeasurementMatches(
  measurementTypes: MeasurementType[],
  inputValue: string,
  selectedDisplay?: string
): MeasurementItem[] {
  const query = normalizeSearchText(inputValue);
  if (!query || query === normalizeSearchText(selectedDisplay ?? "")) {
    return measurementTypes.map((measurement) => ({ kind: "measurement", measurement }));
  }

  return measurementTypes.flatMap((measurement) => {
    const display = normalizeSearchText(measurement.display);
    if (display.startsWith(query)) return [{ kind: "measurement" as const, measurement, rank: 0 }];
    if (display.includes(query)) return [{ kind: "measurement" as const, measurement, rank: 1 }];
    const prefixAlias = measurement.aliases.find((alias) => normalizeSearchText(alias).startsWith(query));
    if (prefixAlias) return [{ kind: "measurement" as const, measurement, matchedAlias: prefixAlias, rank: 2 }];
    const substringAlias = measurement.aliases.find((alias) => normalizeSearchText(alias).includes(query));
    if (substringAlias) return [{ kind: "measurement" as const, measurement, matchedAlias: substringAlias, rank: 3 }];
    return [];
  }).sort((left, right) => left.rank - right.rank || left.measurement.display.localeCompare(right.measurement.display));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}
