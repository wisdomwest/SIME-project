/**
 * Lightweight URL state hook. Avoids a router library; uses window.history.
 * URL is the single source of truth for: datasetId, current page, filters,
 * selected node, replay state, and which Python tab is active.
 */

import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'landing' }
  | { name: 'overview'; datasetId: string }
  | { name: 'network'; datasetId: string }
  | { name: 'sentiment'; datasetId: string }
  | { name: 'disinfo'; datasetId: string }
  | { name: 'hashtags'; datasetId: string }
  | { name: 'censorship'; datasetId: string }
  | { name: 'drift'; datasetId: string }
  | { name: 'commercial'; datasetId: string }
  | { name: 'report'; datasetId: string }
  | { name: 'account'; datasetId: string; nodeId: string }
  | { name: 'docs' }

export interface RouteExtras {
  selectedNode?: string;
  search?: string;
  sentiment?: string[];
  platform?: string;
  topic?: string;
  minFollowers?: number;
  minDegree?: number;
  sortBy?: string;
  dateFrom?: string;
  dateTo?: string;
  selectedCluster?: number;
  replayTime?: number;
  pyTab?: string;
}

function parseHash(hash: string): { route: Route; extras: RouteExtras } {
  // Accept both /d/x/network and #/d/x/network
  const raw = hash.replace(/^#?\/?/, '').replace(/\/$/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart || '');

  const extras: RouteExtras = {};
  if (params.has('node')) extras.selectedNode = params.get('node')!;
  if (params.has('q')) extras.search = params.get('q')!;
  const s = params.getAll('s');
  if (s.length) extras.sentiment = s;
  if (params.has('platform')) extras.platform = params.get('platform')!;
  if (params.has('topic')) extras.topic = params.get('topic')!;
  if (params.has('mf')) extras.minFollowers = parseInt(params.get('mf')!);
  if (params.has('md')) extras.minDegree = parseInt(params.get('md')!);
  if (params.has('sort')) extras.sortBy = params.get('sort')!;
  if (params.has('from')) extras.dateFrom = params.get('from')!;
  if (params.has('to')) extras.dateTo = params.get('to')!;
  if (params.has('cluster')) extras.selectedCluster = parseInt(params.get('cluster')!);
  if (params.has('t')) extras.replayTime = parseInt(params.get('t')!);
  if (params.has('py')) extras.pyTab = params.get('py')!;

  // /docs — standalone documentation page (no dataset needed)
  if (segs[0] === 'docs') return { route: { name: 'docs' }, extras };

  // /d/:datasetId/:page?
  if (segs[0] === 'd' && segs[1]) {
    const datasetId = decodeURIComponent(segs[1]);
    const page = segs[2] || 'overview';
    const base = { datasetId };
    if (page === 'network') return { route: { name: 'network', ...base }, extras };
    if (page === 'sentiment') return { route: { name: 'sentiment', ...base }, extras };
    if (page === 'disinfo') return { route: { name: 'disinfo', ...base }, extras };
    if (page === 'hashtags') return { route: { name: 'hashtags', ...base }, extras };
    if (page === 'censorship') return { route: { name: 'censorship', ...base }, extras };
    if (page === 'drift') return { route: { name: 'drift', ...base }, extras };
    if (page === 'commercial') return { route: { name: 'commercial', ...base }, extras };
    if (page === 'report') return { route: { name: 'report', ...base }, extras };
    if (page === 'docs') return { route: { name: 'docs' }, extras };
    if (page === 'account' && segs[3]) {
      return { route: { name: 'account', ...base, nodeId: decodeURIComponent(segs[3]) }, extras };
    }
    return { route: { name: 'overview', ...base }, extras };
  }
  return { route: { name: 'landing' }, extras };
}

function buildHash(route: Route, extras: RouteExtras): string {
  const params = new URLSearchParams();
  if (extras.selectedNode) params.set('node', extras.selectedNode);
  if (extras.search) params.set('q', extras.search);
  (extras.sentiment || []).forEach((s) => params.append('s', s));
  if (extras.platform && extras.platform !== 'All Platforms') params.set('platform', extras.platform);
  if (extras.topic && extras.topic !== 'All Topics') params.set('topic', extras.topic);
  if (extras.minFollowers) params.set('mf', String(extras.minFollowers));
  if (extras.minDegree) params.set('md', String(extras.minDegree));
  if (extras.sortBy && extras.sortBy !== 'Degree') params.set('sort', extras.sortBy);
  if (extras.dateFrom) params.set('from', extras.dateFrom);
  if (extras.dateTo) params.set('to', extras.dateTo);
  if (typeof extras.selectedCluster === 'number' && extras.selectedCluster >= 0) params.set('cluster', String(extras.selectedCluster));
  if (extras.replayTime) params.set('t', String(extras.replayTime));
  if (extras.pyTab) params.set('py', extras.pyTab);

  let path = '';
  if (route.name === 'landing') path = '/';
  else if (route.name === 'docs') path = '/docs';
  else {
    const d = encodeURIComponent(route.datasetId);
    const p =
      route.name === 'overview' ? '' :
      route.name === 'network' ? '/network' :
      route.name === 'sentiment' ? '/sentiment' :
      route.name === 'disinfo' ? '/disinfo' :
      route.name === 'hashtags' ? '/hashtags' :
      route.name === 'censorship' ? '/censorship' :
      route.name === 'drift' ? '/drift' :
      route.name === 'commercial' ? '/commercial' :
      route.name === 'report' ? '/report' :
      route.name === 'account' ? `/account/${encodeURIComponent(route.nodeId)}` : '';
    path = `/d/${d}${p}`;
  }
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function useUrlState() {
  const [state, setState] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    function onChange() {
      setState(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((route: Route, extras: RouteExtras = {}) => {
    const next = buildHash(route, extras);
    if (window.location.hash !== next) {
      window.location.hash = next;
    } else {
      // Force re-parse even if hash is the same.
      setState({ route, extras });
    }
  }, []);

  const updateExtras = useCallback((partial: Partial<RouteExtras>) => {
    setState((prev) => {
      const merged = { ...prev.extras, ...partial };
      const hash = buildHash(prev.route, merged);
      if (window.location.hash !== hash) window.location.hash = hash;
      return { route: prev.route, extras: merged };
    });
  }, []);

  return { ...state, navigate, updateExtras };
}
