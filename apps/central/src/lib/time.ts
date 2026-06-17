export function now(): Date {
  return new Date();
}

export function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return value.toISOString();
}
