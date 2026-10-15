// Series timestamps come from two sources: historical synthetic samples
// use a plain "HH:MM" label, while live samples are full ISO strings
// (new Date().toISOString()). Normalize both to the browser's local time
// so the UI never leaks a raw "T"/"Z" from an unformatted ISO string.
//
// Cached because chart axes (e.g. TrendsChart, with thousands of points)
// call this once per tick during layout measurement — toLocaleTimeString
// is too slow to run uncached at that volume without blocking the UI.
const cache = new Map<string, string>();

export function formatTimestamp(raw: string | undefined | null): string {
  if (!raw) return '—';
  const cached = cache.get(raw);
  if (cached !== undefined) return cached;

  let result: string;
  if (!raw.includes('T')) {
    result = raw; // already "HH:MM"
  } else {
    const date = new Date(raw);
    result = Number.isNaN(date.getTime())
      ? raw
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  cache.set(raw, result);
  return result;
}
