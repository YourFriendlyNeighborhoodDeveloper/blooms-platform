/** Spreadsheet formula prefixes are neutralized so an exported customer name cannot run as a formula. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns?: Array<keyof T & string>): string {
  const cols = columns ?? (rows[0] ? (Object.keys(rows[0]) as Array<keyof T & string>) : []);
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}
