import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Vertex, Edge } from '../engine/csvParserEnhanced';
import { Loader2, ZoomIn } from 'lucide-react';

interface NetworkGraphProps {
  vertices: Vertex[];
  edges: Edge[];
  onNodeSelect?: (nodeId: string) => void;
  isActive?: boolean;
}

const MAX_RENDER_NODES = 500;
const RENDER_TIMEOUT_MS = 8000;

const CLUSTER_COLORS = [
  '#facc15', '#3b82f6', '#10b981', '#f43f5e', '#8b5cf6',
  '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#f97316',
  '#6366f1', '#14b8a6', '#e11d48', '#a855f7', '#0ea5e9',
];

const NetworkGraph: React.FC<NetworkGraphProps> = ({ vertices, edges, onNodeSelect, isActive = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [showFullGraph, setShowFullGraph] = useState(false);
  const mountedRef = useRef(true);

  const effectiveLimit = showFullGraph ? MAX_RENDER_NODES * 4 : MAX_RENDER_NODES;

  const displayVertices = React.useMemo(() => {
    if (vertices.length <= effectiveLimit) return vertices;
    return [...vertices]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, effectiveLimit);
  }, [vertices, effectiveLimit]);

  const displayEdges = React.useMemo(() => {
    const nodeIds = new Set(displayVertices.map(v => v.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [edges, displayVertices]);

  const initGraph = useCallback(async () => {
    if (!containerRef.current || displayVertices.length === 0) return;

    // Destroy previous
    if (cyRef.current) {
      try { cyRef.current.destroy(); } catch (_) {}
      cyRef.current = null;
    }

    setIsReady(false);
    setIsRendering(true);
    mountedRef.current = true;

    // Safety timeout: force-ready after 8s
    const safetyTimer = setTimeout(() => {
      if (mountedRef.current && !isReady) {
        setIsReady(true);
        setIsRendering(false);
      }
    }, RENDER_TIMEOUT_MS);

    try {
      const cytoscape = (await import('cytoscape')).default;
      if (!mountedRef.current || !containerRef.current) return;

      const maxDegree = Math.max(...displayVertices.map(v => v.degree), 1);
      const nodeSize = (d: number) => Math.max(3, Math.min(20, 3 + (d / maxDegree) * 17));

      const nodeSet = new Set(displayVertices.map(v => v.id));
      const filteredEdges = displayEdges
        .filter(e => nodeSet.has(e.source) && nodeSet.has(e.target))
        .slice(0, 3000); // Hard cap edges

      const elements: any[] = [
        ...displayVertices.map(v => ({
          data: {
            id: v.id,
            label: v.label.length > 12 ? v.label.slice(0, 12) : v.label,
            degree: v.degree,
            cluster: v.cluster,
            sentiment: v.sentiment,
            size: nodeSize(v.degree),
            color: CLUSTER_COLORS[(v.cluster >= 0 ? v.cluster : 0) % CLUSTER_COLORS.length],
          },
        })),
        ...filteredEdges.map(e => ({
          data: { id: `${e.source}|||${e.target}`, source: e.source, target: e.target },
        })),
      ];

      const cy = cytoscape({
        container: containerRef.current,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': 'data(color)',
              'width': 'data(size)',
              'height': 'data(size)',
              'label': 'data(label)',
              'font-size': '6px',
              'color': '#64748b',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 2,
              'border-width': 0.5,
              'border-color': '#0f172a',
            },
          },
          {
            selector: 'node[sentiment="Pos"]',
            style: { 'border-color': '#10b981', 'border-width': 1.5 },
          },
          {
            selector: 'node[sentiment="Neg"]',
            style: { 'border-color': '#ef4444', 'border-width': 1.5 },
          },
          {
            selector: 'edge',
            style: {
              'width': 0.2,
              'line-color': '#1e293b',
              'opacity': 0.1,
              'curve-style': 'haystack',
            },
          },
          {
            selector: ':selected',
            style: { 'border-color': '#facc15', 'border-width': 2.5 },
          },
        ],
        layout: {
          name: 'cose',
          animate: false,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 60,
          gravity: 0.25,
          numIter: displayVertices.length > 300 ? 300 : 800,
          coolingFactor: 0.95,
          fit: true,
          padding: 30,
        },
        minZoom: 0.05,
        maxZoom: 5,
        wheelSensitivity: 0.3,
        pixelRatio: 1,
      });

      cyRef.current = cy;

      // Listen for layout stop
      cy.one('layoutstop', () => {
        if (mountedRef.current) {
          clearTimeout(safetyTimer);
          setIsReady(true);
          setIsRendering(false);
        }
      });

      if (onNodeSelect) {
        cy.on('tap', 'node', (evt: any) => onNodeSelect(evt.target.id()));
      }
    } catch (err) {
      console.error('Cytoscape init error:', err);
      clearTimeout(safetyTimer);
      if (mountedRef.current) {
        setIsReady(true);
        setIsRendering(false);
      }
    }
  }, [displayVertices, displayEdges, onNodeSelect]);

  useEffect(() => {
    mountedRef.current = true;
    if (isActive && displayVertices.length > 0) {
      const timer = setTimeout(() => initGraph(), 50);
      return () => {
        mountedRef.current = false;
        clearTimeout(timer);
        if (cyRef.current) {
          try { cyRef.current.destroy(); } catch (_) {}
          cyRef.current = null;
        }
      };
    }
    return () => { mountedRef.current = false; };
  }, [isActive, showFullGraph, vertices.length > 0]);

  return (
    <div className="w-full h-full relative bg-[#0a0f1e] rounded-2xl border border-white/5 overflow-hidden">
      {/* Loading spinner */}
      {isRendering && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[#0a0f1e]">
          <Loader2 size={24} className="text-[#facc15] animate-spin" />
          <p className="text-xs text-text-muted">
            Laying out {displayVertices.length.toLocaleString()} nodes...
          </p>
        </div>
      )}

      {/* Graph container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0" />

      {/* Empty state */}
      {displayVertices.length === 0 && !isRendering && (
        <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
          Upload data to visualize the network graph
        </div>
      )}

      {/* Footer bar */}
      {isReady && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[10px] text-text-muted bg-[#0a0f1e]/95 px-3 py-1.5 rounded-lg border border-white/5">
          <span>
            {displayVertices.length.toLocaleString()} nodes · {displayEdges.length.toLocaleString()} edges
            {vertices.length > effectiveLimit && ` (top ${effectiveLimit.toLocaleString()} of ${vertices.length.toLocaleString()})`}
          </span>
          <span className="hidden sm:inline opacity-50">Scroll zoom · Drag pan · Click node</span>
          {vertices.length > MAX_RENDER_NODES && !showFullGraph && (
            <button
              onClick={() => setShowFullGraph(true)}
              className="flex items-center gap-1 text-[#facc15] hover:text-yellow-300 font-bold transition-colors"
              title="Render 2000 nodes (slower)"
            >
              <ZoomIn size={12} />
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default NetworkGraph;
