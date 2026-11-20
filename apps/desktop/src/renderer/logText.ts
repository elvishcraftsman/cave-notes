/** The lines of a log that were written on a day (the person's own day, not UTC). Lines start with an ISO time; one that does not belongs to the line before it. */
export function logLinesOfDay(text: string, day: Date = new Date()): string {
  const same = (d: Date): boolean => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
  const out: string[] = [];
  let keep = false;
  for (const line of text.split('\n')) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s/.exec(line);
    if (m) keep = same(new Date(m[1]!));
    if (keep) out.push(line);
  }
  return out.join('\n');
}
