export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sortSuggestions<T extends { validated?: boolean; confidence: number }>(arr: T[]): T[] {
  return arr.sort((a, b) => {
    if (a.validated && !b.validated) return -1;
    if (!a.validated && b.validated) return 1;
    return b.confidence - a.confidence;
  });
}
