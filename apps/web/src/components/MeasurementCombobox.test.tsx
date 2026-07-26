// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { defaultMeasurementTypes, type MeasurementType } from "@vitana/shared";
import { describe, expect, it, vi } from "vitest";
import { MeasurementCombobox } from "./MeasurementCombobox.js";

const measurementTypes = defaultMeasurementTypes.filter((measurement) =>
  ["bmi", "body_fat_pct", "hba1c", "weight"].includes(measurement.code)
);

describe("MeasurementCombobox", () => {
  it("ranks display-prefix matches before display-substring matches", () => {
    renderCombobox();

    fireEvent.change(screen.getByRole("combobox", { name: "Measurement" }), {
      target: { value: "body" }
    });

    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options.slice(0, 2)).toEqual([
      expect.stringContaining("Body fat percentage"),
      expect.stringContaining("BMI (Body mass index)")
    ]);
    expect(options[2]).toContain("Matches “body_weight”");
    expect(options.at(-1)).toBe("Use a custom measurement");
  });

  it("finds measurements by aliases and shows the matched alias", () => {
    renderCombobox();

    fireEvent.change(screen.getByRole("combobox", { name: "Measurement" }), {
      target: { value: "hemoglobin" }
    });

    expect(screen.getByText(/Matches “hemoglobin a1c”/)).toBeInTheDocument();
  });

  it("selects known measurements and offers an explicit custom action", () => {
    const onSelect = vi.fn<(measurement: MeasurementType) => void>();
    const onSelectCustom = vi.fn();
    renderCombobox({ onSelect, onSelectCustom });

    fireEvent.change(screen.getByRole("combobox", { name: "Measurement" }), {
      target: { value: "weight" }
    });
    fireEvent.click(screen.getByRole("option", { name: /Weight/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ code: "weight" }));

    fireEvent.click(screen.getByRole("button", { name: "Open measurement choices" }));
    fireEvent.click(screen.getByRole("option", { name: "Use a custom measurement" }));
    expect(onSelectCustom).toHaveBeenCalledOnce();
  });
});

function renderCombobox({
  onSelect = vi.fn(),
  onSelectCustom = vi.fn()
}: {
  onSelect?: (measurement: MeasurementType) => void;
  onSelectCustom?: () => void;
} = {}) {
  render(
    <MeasurementCombobox
      id="measurement"
      ariaLabel="Measurement"
      measurementTypes={measurementTypes}
      selectedCode=""
      onSelect={onSelect}
      onSelectCustom={onSelectCustom}
    />
  );
}
