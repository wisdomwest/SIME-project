import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Vertex, Edge } from '../../engine/csvParserEnhanced';
import { Loader2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { safeImgUrl } from '../../app/format';

interface NetworkGraphProps {
  vertices: Vertex[];
  edges: Edge[];
  filteredVertices?: Vertex[];
  filteredEdges?: Edge[];
  onNodeSelect?: (nodeId: string) => void;
  isActive?: boolean;
  /** @deprecated use filteredVertices/filteredEdges instead */
  compact?: boolean;
}

const MAX_RENDER_NODES = 800;
const RENDER_TIMEOUT_MS = 12000;

const CLUSTER_COLORS = [
  '#C2410C', '#3b82f6', '#10b981', '#ef4444', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e', '#6366f1',
  '#84cc16', '#a855f7', '#06b6d4', '#eab308', '#d946ef',
];

const NetworkGraph: React.FC<NetworkGraphProps> = ({
  vertices,
  edges,
  filteredVertices,
  filteredEdges,
  onNodeSelect,
  isActive = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [showFullGraph, setShowFullGraph] = useState(false);
  const mountedRef = useRef(true);

  // Monitor theme changes to dynamically switch graph text/border colors between light/dark
  const [isDark, setIsDark] = useState(() => 
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
    };
  }, []);

  const onNodeSelectRef = useRef(onNodeSelect);
  useEffect(() => {
    onNodeSelectRef.current = onNodeSelect;
  }, [onNodeSelect]);

  const effectiveLimit = showFullGraph ? MAX_RENDER_NODES * 2 : MAX_RENDER_NODES;

  // Base graph elements loaded in Cytoscape (unfiltered layout)
  const baseDisplayVertices = useMemo(() => {
    if (vertices.length <= effectiveLimit) return vertices;
    return [...vertices].sort((a, b) => b.degree - a.degree).slice(0, effectiveLimit);
  }, [vertices, effectiveLimit]);

  const baseDisplayEdges = useMemo(() => {
    const ids = new Set(baseDisplayVertices.map((v) => v.id));
    return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [baseDisplayVertices, edges]);

  // Display variables for visibility filtering
  const displayVertices = filteredVertices || vertices;
  const displayEdges = filteredEdges || edges;

  // Filtered visible elements (used for footer stats)
  const visibleVertices = useMemo(() => {
    if (displayVertices.length <= effectiveLimit) return displayVertices;
    return [...displayVertices].sort((a, b) => b.degree - a.degree).slice(0, effectiveLimit);
  }, [displayVertices, effectiveLimit]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleVertices.map((v) => v.id));
    return displayEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [displayEdges, visibleVertices]);

  const applyFilters = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const visibleNodeIds = new Set(displayVertices.map(v => v.id));
    const visibleEdgeIds = new Set(displayEdges.map(e => `${e.source}|||${e.target}`));

    cy.batch(() => {
      cy.nodes().forEach((node: any) => {
        if (visibleNodeIds.has(node.id())) {
          node.style('display', 'element');
        } else {
          node.style('display', 'none');
        }
      });

      cy.edges().forEach((edge: any) => {
        if (visibleEdgeIds.has(edge.id())) {
          edge.style('display', 'element');
        } else {
          edge.style('display', 'none');
        }
      });
    });
  }, [displayVertices, displayEdges]);

  // Apply visibility filters when filtered props change
  useEffect(() => {
    if (isReady) {
      applyFilters();
    }
  }, [isReady, applyFilters]);

  const initGraph = useCallback(async () => {
    if (!containerRef.current || baseDisplayVertices.length === 0) return;
    if (cyRef.current) {
      try { cyRef.current.destroy(); } catch (_) {}
      cyRef.current = null;
    }
    setIsReady(false);
    setIsRendering(true);
    mountedRef.current = true;

    const safetyTimer = setTimeout(() => {
      if (mountedRef.current && !isReady) {
        setIsReady(true);
        setIsRendering(false);
      }
    }, RENDER_TIMEOUT_MS);

    try {
      const cytoscape = (await import('cytoscape')).default;
      if (!mountedRef.current || !containerRef.current) return;

      const maxDegree = Math.max(...baseDisplayVertices.map((v) => v.degree), 1);
      const nodeSize = (d: number) => Math.max(6, Math.min(36, 6 + (d / maxDegree) * 30));

      const elements: any[] = [
        ...baseDisplayVertices.map((v) => ({
          data: {
            id: v.id,
            label: v.label.length > 14 ? v.label.slice(0, 14) : v.label,
            degree: v.degree,
            cluster: v.cluster,
            sentiment: v.sentiment,
            size: nodeSize(v.degree),
            color: CLUSTER_COLORS[(v.cluster >= 0 ? v.cluster : 0) % CLUSTER_COLORS.length],
            image_url: v.image_url || '',
            x: v.x,
            y: v.y,
          },
        })),
        ...baseDisplayEdges.slice(0, 6000).map((e) => ({
          data: {
            id: `${e.source}|||${e.target}`,
            source: e.source,
            target: e.target,
            time: e.date ? new Date(e.date).getTime() : 0,
          },
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
              'font-size': '8px',
              'color': isDark ? '#E6E1D8' : '#3A3A3A',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 3,
              'border-width': 0.5,
              'border-color': isDark ? '#0C0B0A' : '#F2EDE2',
              'background-image': (node: any) => {
                const img = safeImgUrl(node.data('image_url'));
                return img || 'none';
              },
              'background-fit': 'cover',
            },
          },
          {
            selector: 'node[sentiment="Pos"]',
            style: { 'border-color': '#0F5132', 'border-width': 2 },
          },
          {
            selector: 'node[sentiment="Neg"]',
            style: { 'border-color': '#7F1D1D', 'border-width': 2 },
          },
          {
            selector: 'edge',
            style: {
              'width': 0.4,
              'line-color': isDark ? '#E6E1D8' : '#1A1A1A',
              'opacity': isDark ? 0.20 : 0.12,
              'curve-style': 'bezier',
            },
          },
          {
            selector: ':selected',
            style: { 'border-color': '#C2410C', 'border-width': 3 },
          },
        ],
        layout: { name: 'null' },
        minZoom: 0.05,
        maxZoom: 5,
        wheelSensitivity: 0.25,
        pixelRatio: 1,
      });

      cyRef.current = cy;
      const hasCoordinates = baseDisplayVertices.some(v => v.x !== undefined && v.x !== 0 && v.y !== undefined && v.y !== 0);
      const layoutOptions = hasCoordinates
        ? {
            name: 'preset',
            positions: (node: any) => ({ x: node.data('x'), y: node.data('y') }),
            fit: true,
            padding: 40,
          }
        : {
            name: 'cose',
            animate: false,
            nodeRepulsion: () => 12000,
            idealEdgeLength: () => 70,
            gravity: 0.25,
            numIter: baseDisplayVertices.length > 300 ? 300 : 800,
            coolingFactor: 0.95,
            fit: true,
            padding: 40,
          };

      cy.one('layoutstop', () => {
        if (mountedRef.current) {
          clearTimeout(safetyTimer);
          setIsReady(true);
          setIsRendering(false);
        }
      });

      cy.layout(layoutOptions).run();

      if (hasCoordinates && mountedRef.current) {
        clearTimeout(safetyTimer);
        setIsReady(true);
        setIsRendering(false);
      }

      cy.on('tap', 'node', (evt: any) => {
        onNodeSelectRef.current?.(evt.target.id());
      });
    } catch (err) {
      console.error('Cytoscape init error:', err);
      clearTimeout(safetyTimer);
      if (mountedRef.current) {
        setIsReady(true);
        setIsRendering(false);
      }
    }
  }, [baseDisplayVertices, baseDisplayEdges, isDark]);

  useEffect(() => {
    mountedRef.current = true;
    if (isActive && baseDisplayVertices.length > 0) {
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
  }, [isActive, showFullGraph, initGraph]);

  const zoomIn = () => cyRef.current?.zoom({ level: cyRef.current.zoom() * 1.4, renderedPosition: { x: containerRef.current!.clientWidth / 2, y: containerRef.current!.clientHeight / 2 } });
  const zoomOut = () => cyRef.current?.zoom({ level: cyRef.current.zoom() * 0.7, renderedPosition: { x: containerRef.current!.clientWidth / 2, y: containerRef.current!.clientHeight / 2 } });
  const fit = () => cyRef.current?.fit(undefined, 30);

  return (
    <div className="w-full h-full relative bg-paper border border-rule overflow-hidden">
      {/* Loading */}
      {isRendering && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-paper/90">
          <Loader2 size={20} className="text-ember animate-spin" />
          <p className="text-xs text-ink-soft">Laying out {baseDisplayVertices.length.toLocaleString()} nodes…</p>
        </div>
      )}

      {/* Graph */}
      <div ref={containerRef} className="w-full h-full absolute inset-0" />

      {/* Empty state */}
      {baseDisplayVertices.length === 0 && !isRendering && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-mute text-sm">
          Upload data to visualise the network graph.
        </div>
      )}

      {/* Controls */}
      {isReady && (
        <div className="absolute top-3 right-3 z-10 flex gap-1">
          <button onClick={zoomIn} className="w-8 h-8 bg-paper border border-rule hover:border-ink text-ink-soft hover:text-ink transition-colors flex items-center justify-center" aria-label="Zoom in">
            <ZoomIn size={12} />
          </button>
          <button onClick={zoomOut} className="w-8 h-8 bg-paper border border-rule hover:border-ink text-ink-soft hover:text-ink transition-colors flex items-center justify-center" aria-label="Zoom out">
            <ZoomOut size={12} />
          </button>
          <button onClick={fit} className="w-8 h-8 bg-paper border border-rule hover:border-ink text-ink-soft hover:text-ink transition-colors flex items-center justify-center" aria-label="Fit">
            <Maximize2 size={12} />
          </button>
        </div>
      )}

      {/* Footer */}
      {isReady && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[10px] font-mono text-ink-mute bg-paper/95 border border-rule px-3 py-1.5">
          <span>
            {visibleVertices.length.toLocaleString()} nodes · {visibleEdges.length.toLocaleString()} edges
            {vertices.length > effectiveLimit && (
              <span className="text-ember"> · top {effectiveLimit} of {vertices.length.toLocaleString()}</span>
            )}
          </span>
          <span className="hidden sm:inline opacity-70">Scroll · drag · click</span>
          {vertices.length > MAX_RENDER_NODES && !showFullGraph && (
            <button
              onClick={() => setShowFullGraph(true)}
              className="text-ember hover:text-ember-strong font-semibold transition-colors"
            >
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export { NetworkGraph };
