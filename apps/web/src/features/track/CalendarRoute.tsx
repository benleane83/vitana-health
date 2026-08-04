import { useEffect, useMemo, useState } from "react";
import type { CalendarMonthData, HealthEvent, LatestMetric, MeasurementType } from "@vitana/shared";
import { api } from "../../api.js";
import { CalendarPage } from "../../pages/CalendarPage.js";

type RemoteState<T> = { data?: T; busy: boolean; error?: string };

export function CalendarRoute({
  activeProfileId,
  measurementTypes,
  latestMetrics,
  recordedCodes
}: {
  activeProfileId?: string;
  measurementTypes: MeasurementType[];
  latestMetrics: LatestMetric[];
  recordedCodes: string[];
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const today = localDate(new Date(), timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthState, setMonthState] = useState<RemoteState<CalendarMonthData>>({ busy: false });
  const [events, setEvents] = useState<RemoteState<HealthEvent[]>>({ busy: false, data: [] });
  const [retryToken, setRetryToken] = useState(0);
  const [eventRetryToken, setEventRetryToken] = useState(0);

  const recordedMeasurements = useMemo(() => {
    const codes = new Set(recordedCodes);
    return measurementTypes.filter((measurement) => codes.has(measurement.code));
  }, [measurementTypes, recordedCodes]);
  const selectedMeasurements = selectedCodes.flatMap((code) => {
    const measurement = measurementTypes.find((type) => type.code === code);
    return measurement ? [measurement] : [];
  });

  useEffect(() => {
    if (selectedCodes.length || !recordedMeasurements.length) return;
    const latest = [...latestMetrics]
      .filter((metric) => recordedMeasurements.some((measurement) => measurement.code === metric.code))
      .sort((left, right) =>
        Number(right.isPinned) - Number(left.isPinned) || right.observedAt.localeCompare(left.observedAt))[0];
    setSelectedCodes([latest?.code ?? recordedMeasurements[0].code]);
  }, [latestMetrics, recordedMeasurements, selectedCodes.length]);

  useEffect(() => {
    const controller = new AbortController();
    const requestedCodes = selectedCodes.length ? selectedCodes : ["activity_sessions"];
    setMonthState((current) => ({ ...current, busy: true, error: undefined }));
    void api.calendarMonth({ month, timezone, measurementCodes: requestedCodes }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setMonthState({ busy: false, data });
        setSelectedDate((current) => initialSelectedDate(data, month, today, current));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMonthState({
          busy: false,
          error: error instanceof Error ? error.message : "Unable to load calendar."
        });
      });
    return () => controller.abort();
  }, [activeProfileId, month, timezone, selectedCodes.join(","), retryToken]);

  useEffect(() => {
    const summary = monthState.data?.events.find((entry) => entry.date === selectedDate);
    if (!summary?.count) {
      setEvents({ busy: false, data: [] });
      return;
    }
    const controller = new AbortController();
    const { start, end } = localDayRange(selectedDate, timezone);
    setEvents({ busy: true, data: [] });
    void api.care.listHealthEvents({
      status: "completed",
      occurredFrom: start,
      occurredTo: end,
      limit: 100
    }, controller.signal).then((result) => {
      if (!controller.signal.aborted) setEvents({ busy: false, data: result.items });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setEvents({
        busy: false,
        data: [],
        error: error instanceof Error ? error.message : "Unable to load event details."
      });
    });
    return () => controller.abort();
  }, [activeProfileId, selectedDate, timezone, monthState.data, eventRetryToken]);

  function moveMonth(offset: number) {
    const [year, monthNumber] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
    const nextMonth = next.toISOString().slice(0, 7);
    setMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  }

  return (
    <CalendarPage
      month={month}
      timezone={timezone}
      data={monthState.data}
      loading={monthState.busy}
      error={monthState.error}
      availableMeasurements={recordedMeasurements}
      selectedMeasurements={selectedMeasurements}
      selectedDate={selectedDate}
      today={today}
      eventDetails={events.data ?? []}
      eventLoading={events.busy}
      eventError={events.error}
      onPreviousMonth={() => moveMonth(-1)}
      onNextMonth={() => moveMonth(1)}
      onToday={() => {
        setMonth(today.slice(0, 7));
        setSelectedDate(today);
      }}
      onAddMeasurement={(measurement) => {
        if (selectedCodes.length < 3 && !selectedCodes.includes(measurement.code)) {
          setSelectedCodes((current) => [...current, measurement.code]);
        }
      }}
      onRemoveMeasurement={(code) => setSelectedCodes((current) => current.filter((entry) => entry !== code))}
      onPromoteMeasurement={(code) => setSelectedCodes((current) => [code, ...current.filter((entry) => entry !== code)])}
      onSelectDate={setSelectedDate}
      onRetry={() => setRetryToken((value) => value + 1)}
      onRetryEvents={() => setEventRetryToken((value) => value + 1)}
    />
  );
}

function initialSelectedDate(
  data: CalendarMonthData,
  month: string,
  today: string,
  current: string
): string {
  if (today.startsWith(month)) return today;
  if (current.startsWith(month) && current !== `${month}-01`) return current;
  return [...data.measurements.map((point) => point.date), ...data.events.map((event) => event.date)].sort()[0]
    ?? `${month}-01`;
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function localDayRange(date: string, timezone: string): { start: string; end: string } {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: zonedMidnightIso(date, timezone),
    end: new Date(
      new Date(zonedMidnightIso(next.toISOString().slice(0, 10), timezone)).getTime() - 1
    ).toISOString()
  };
}

function zonedMidnightIso(date: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  let instant = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const represented = Date.UTC(
      value("year"), value("month") - 1, value("day"),
      value("hour"), value("minute"), value("second")
    );
    instant += Date.UTC(year, month - 1, day) - represented;
  }
  return new Date(instant).toISOString();
}
