import { ReactNode, useState, useRef, useEffect } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => number | string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  maxHeight?: number;
  dense?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyText = 'No data',
  maxHeight,
  dense = false,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const sorted = useRef(rows);

  useEffect(() => {
    sorted.current = rows;
  }, [rows]);

  const sortedRows = sort
    ? [...rows].sort((a, b) => {
        const col = columns.find((c) => c.key === sort.key);
        if (!col?.sortValue) return 0;
        const va = col.sortValue(a);
        const vb = col.sortValue(b);
        if (va < vb) return sort.dir === 'asc' ? -1 : 1;
        if (va > vb) return sort.dir === 'asc' ? 1 : -1;
        return 0;
      })
    : rows;

  return (
    <div className="border border-rule bg-paper" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="w-full text-sm">
        <thead className="bg-paper-2 sticky top-0 z-[1]">
          <tr className="border-b border-rule">
            {columns.map((c) => {
              const isSorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={() => c.sortValue && setSort((s) => {
                    if (!s || s.key !== c.key) return { key: c.key, dir: 'asc' };
                    if (s.dir === 'asc') return { key: c.key, dir: 'desc' };
                    return null;
                  })}
                  className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-mute ${
                    dense ? 'py-2 px-3' : 'py-3 px-4'
                  } text-${c.align ?? 'left'} ${c.sortValue ? 'cursor-pointer hover:text-ink select-none' : ''}`}
                >
                  {c.header}
                  {isSorted && <span className="ml-1 text-ember">{sort?.dir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={`text-center text-ink-mute ${dense ? 'py-6' : 'py-10'}`}>
                {emptyText}
              </td>
            </tr>
          )}
          {sortedRows.map((r, i) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-rule last:border-b-0 transition-colors ${
                onRowClick ? 'cursor-pointer hover:bg-paper-2' : ''
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${dense ? 'py-2 px-3' : 'py-3 px-4'} text-${c.align ?? 'left'}`}
                >
                  {c.render(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
