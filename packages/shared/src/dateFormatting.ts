export function isUtcMidnightTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) &&
    timestamp.getUTCHours() === 0 &&
    timestamp.getUTCMinutes() === 0 &&
    timestamp.getUTCSeconds() === 0 &&
    timestamp.getUTCMilliseconds() === 0;
}