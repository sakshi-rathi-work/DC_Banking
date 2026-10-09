/**
 * CSV worker for Piscina thread pool.
 * Generates CSV content from structured data off the main thread.
 */

interface CsvInput {
  columns: string[];
  rows: Record<string, string | number | null | undefined>[];
}

function escapeCell(value: string): string {
  // CSV RFC 4180: fields containing commas, newlines, or quotes must be quoted
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export default function handler(input: CsvInput): { csv: string } {
  const { columns, rows } = input;

  // Header row
  const lines: string[] = [columns.map(escapeCell).join(',')];

  // Data rows
  for (const row of rows) {
    const cells = columns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      return escapeCell(String(val));
    });
    lines.push(cells.join(','));
  }

  return { csv: lines.join('\n') + '\n' };
}
