/** "Index of /, Database error" → ["Index of /", "Database error"]: trimmed, empties and repeats dropped. */
export function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}
