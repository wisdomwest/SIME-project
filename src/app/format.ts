export function safeImgUrl(image_url?: string): string | null {
  if (!image_url) return null;
  const clean = image_url.replace(/\\/g, '/');
  if (clean.startsWith('http') || clean.startsWith('/')) return clean;
  return `/api/simelab/images/${clean}`;
}

export function initials(name: string): string {
  const cleaned = name.replace(/^@/, '').replace(/[_\-.]+/g, ' ').trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function parseDate(val: string | number | undefined | null): Date | null {
  if (val === undefined || val === null || val === '') return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val).trim());
  if (!isNaN(num) && num > 10000 && num < 100000 && /^\d+(\.\d+)?$/.test(String(val).trim())) {
    return new Date(Math.round((num - 25569) * 86400 * 1000));
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDate(iso: string | number | undefined | null): string {
  const d = parseDate(iso);
  if (!d) return String(iso || '—');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDate(iso: string | number | undefined | null): string {
  const d = parseDate(iso);
  if (!d) return String(iso || '—');
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function sentimentTone(s: 'Pos' | 'Neu' | 'Neg' | string | undefined): 'pos' | 'neg' | 'neu' {
  if (s === 'Pos' || s === 'Positive') return 'pos';
  if (s === 'Neg' || s === 'Negative') return 'neg';
  return 'neu';
}

/** User-facing names for structural, non-emotional cluster codes. */
export function sentimentLabel(s: 'Pos' | 'Neu' | 'Neg' | string | undefined): string {
  if (s === 'Pos' || s === 'Positive') return 'Connector';
  if (s === 'Neg' || s === 'Negative') return 'Broadcaster';
  return 'Neutral';
}
