/**
 * Normalize values before any Firestore write.
 * Firestore rejects undefined at any depth; null remains an intentional value.
 */
export function firestoreSafe<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined).map((entry) => firestoreSafe(entry)) as T;
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) output[key] = firestoreSafe(entry);
    }
    return output as T;
  }
  return value;
}
