import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Vertex, Edge } from '../engine/csvParserEnhanced';
import { Loader2, ZoomIn, Play, Pause, RotateCcw } from 'lucide-react';

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

  const edgeTimestamps = React.useMemo(() => {
    const times = edges
      .map(e => e.date ? new Date(e.date).getTime() : 0)
      .filter(t => t > 0 && !isNaN(t));
    return Array.from(new Set(times)).sort((a, b) => a - b);
  }, [edges]);

  const [sliderIndex, setSliderIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (edgeTimestamps.length > 0) {
      setSliderIndex(edgeTimestamps.length - 1);
    }
  }, [edgeTimestamps]);

  useEffect(() => {
    if (!isPlaying || edgeTimestamps.length === 0) return;

    const timer = setInterval(() => {
      setSliderIndex((prev) => {
        if (prev >= edgeTimestamps.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 150);

    return () => clearInterval(timer);
  }, [isPlaying, edgeTimestamps]);

  const baseVerticesRef = useRef<Vertex[]>([]);
  const baseEdgesRef = useRef<Edge[]>([]);
  const [rebuildTrigger, setRebuildTrigger] = useState(0);

  // Check if we need to rebuild the base graph
  const isNewDataset = useMemo(() => {
    if (vertices.length === 0) return false;
    if (baseVerticesRef.current.length === 0) return true;

    // Check if the current vertices list is larger than the base vertices list,
    // or if a significant portion of the vertices are not in the base set.
    const baseIds = new Set(baseVerticesRef.current.map(v => v.id));
    let newNodesCount = 0;
    const sampleSize = Math.min(vertices.length, 50);
    for (let i = 0; i < sampleSize; i++) {
      if (!baseIds.has(vertices[i].id)) {
        newNodesCount++;
      }
    }
    return newNodesCount > sampleSize * 0.1 || vertices.length > baseVerticesRef.current.length;
  }, [vertices]);

  useEffect(() => {
    if (isNewDataset) {
      baseVerticesRef.current = vertices;
      baseEdgesRef.current = edges;
      setRebuildTrigger(prev => prev + 1);
    }
  }, [isNewDataset, vertices, edges]);

  const effectiveLimit = showFullGraph ? MAX_RENDER_NODES * 4 : MAX_RENDER_NODES;

  // Base graph elements loaded in Cytoscape
  const baseDisplayVertices = React.useMemo(() => {
    const verts = baseVerticesRef.current;
    if (verts.length <= effectiveLimit) return verts;
    return [...verts]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, effectiveLimit);
  }, [rebuildTrigger, effectiveLimit]);

  const baseDisplayEdges = React.useMemo(() => {
    const nodeIds = new Set(baseDisplayVertices.map(v => v.id));
    return baseEdgesRef.current.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [baseDisplayVertices, rebuildTrigger]);

  // Filtered visible elements (used for footer stats)
  const visibleVertices = React.useMemo(() => {
    if (vertices.length <= effectiveLimit) return vertices;
    return [...vertices]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, effectiveLimit);
  }, [vertices, effectiveLimit]);

  const visibleEdges = React.useMemo(() => {
    const nodeIds = new Set(visibleVertices.map(v => v.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [edges, visibleVertices]);

  // Unified callback to apply parent filters + local temporal slider
  const applyFilters = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const visibleNodeIds = new Set(vertices.map(v => v.id));
    const visibleEdgeIds = new Set(edges.map(e => `${e.source}|||${e.target}`));
    
    const threshold = edgeTimestamps.length > 0 ? edgeTimestamps[sliderIndex] : null;

    cy.batch(() => {
      // First update edges
      cy.edges().forEach((edge: any) => {
        const edgeId = edge.id();
        const edgeTime = edge.data('time') || 0;
        
        const isGloballyVisible = visibleEdgeIds.has(edgeId);
        const isTemporallyVisible = threshold === null || edgeTime <= threshold;
        
        if (isGloballyVisible && isTemporallyVisible) {
          edge.style('display', 'element');
        } else {
          edge.style('display', 'none');
        }
      });

      // Now update nodes
      cy.nodes().forEach((node: any) => {
        const nodeId = node.id();
        const isGloballyVisible = visibleNodeIds.has(nodeId);
        
        if (!isGloballyVisible) {
          node.style('display', 'none');
          return;
        }
        
        // If globally visible, check temporal visibility based on connected edges
        const connectedEdges = node.connectedEdges();
        if (connectedEdges.length === 0) {
          node.style('display', 'element');
          return;
        }
        
        const hasVisibleEdge = connectedEdges.some((edge: any) => {
          const edgeId = edge.id();
          const edgeTime = edge.data('time') || 0;
          const isEdgeGloballyVisible = visibleEdgeIds.has(edgeId);
          const isEdgeTemporallyVisible = threshold === null || edgeTime <= threshold;
          return isEdgeGloballyVisible && isEdgeTemporallyVisible;
        });

        if (!hasVisibleEdge) {
          node.style('display', 'none');
        } else {
          node.style('display', 'element');
        }
      });
    });
  }, [vertices, edges, edgeTimestamps, sliderIndex]);

  // Apply visibility filters when filtered props or sliderIndex change
  useEffect(() => {
    if (isReady) {
      applyFilters();
    }
  }, [isReady, applyFilters]);

  const initGraph = useCallback(async () => {
    if (!containerRef.current || baseDisplayVertices.length === 0) return;

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

      const maxDegree = Math.max(...baseDisplayVertices.map(v => v.degree), 1);
      const nodeSize = (d: number) => Math.max(3, Math.min(20, 3 + (d / maxDegree) * 17));

      const nodeSet = new Set(baseDisplayVertices.map(v => v.id));
      const filteredEdges = baseDisplayEdges
        .filter(e => nodeSet.has(e.source) && nodeSet.has(e.target))
        .slice(0, 3000); // Hard cap edges

      const elements: any[] = [
        ...baseDisplayVertices.map(v => ({
          data: {
            id: v.id,
            label: v.label.length > 12 ? v.label.slice(0, 12) : v.label,
            degree: v.degree,
            cluster: v.cluster,
            sentiment: v.sentiment,
            size: nodeSize(v.degree),
            color: CLUSTER_COLORS[(v.cluster >= 0 ? v.cluster : 0) % CLUSTER_COLORS.length],
            image_url: v.image_url || '',
          },
        })),
        ...filteredEdges.map(e => ({
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
              'font-size': '6px',
              'color': '#64748b',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 2,
              'border-width': 0.5,
              'border-color': '#0f172a',
              'background-image': (node: any) => {
                const img = node.data('image_url');
                if (img) {
                  const clean = img.replace(/\\/g, '/');
                  return clean.startsWith('http') || clean.startsWith('/') ? clean : `/api/simelab/images/${clean}`;
                }
                return 'none';
              },
              'background-fit': 'cover',
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
              'width': 0.3,
              'line-color': '#3b82f6',
              'opacity': 0.25,
              'curve-style': 'straight',
              'target-arrow-shape': 'triangle',
              'target-arrow-color': '#3b82f6',
              'arrow-scale': 0.45,
            },
          },
          {
            selector: ':selected',
            style: { 'border-color': '#facc15', 'border-width': 2.5 },
          },
        ],
        layout: { name: 'null' },
        minZoom: 0.05,
        maxZoom: 5,
        wheelSensitivity: 0.3,
        pixelRatio: 1,
        hideEdgesOnViewport: true,
        textureOnViewport: true,
        motionBlur: true,
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

      // Run layout
      cy.layout({
        name: 'cose',
        animate: false,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 60,
        gravity: 0.25,
        numIter: baseDisplayVertices.length > 300 ? 300 : 800,
        coolingFactor: 0.95,
        fit: true,
        padding: 30,
      }).run();

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
  }, [baseDisplayVertices, baseDisplayEdges, onNodeSelect]);

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

  return (
    <div className="w-full h-full relative bg-[#0a0f1e] rounded-2xl border border-white/5 overflow-hidden">
      {/* Loading spinner */}
      {isRendering && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[#0a0f1e]">
          <Loader2 size={24} className="text-[#facc15] animate-spin" />
          <p className="text-xs text-text-muted">
            Laying out {baseDisplayVertices.length.toLocaleString()} nodes...
          </p>
        </div>
      )}

      {/* Graph container */}
      <div ref={containerRef} className="w-full h-full absolute inset-0" />

      {/* Empty state */}
      {baseDisplayVertices.length === 0 && !isRendering && (
        <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
          Upload data to visualize the network graph
        </div>
      )}

      {/* Timeline Replay Control */}
      {isReady && edgeTimestamps.length > 0 && (
        <div className="absolute bottom-12 left-3 right-3 bg-[#0a0f1e]/90 border border-white/10 rounded-xl p-3 space-y-2 z-10">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-1.5 bg-[#facc15] hover:bg-yellow-400 text-[#050a14] rounded-lg transition-colors"
                title={isPlaying ? "Pause replay" : "Play replay"}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={() => {
                  setIsPlaying(false);
                  setSliderIndex(0);
                }}
                className="p-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors"
                title="Restart"
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={edgeTimestamps.length - 1}
                value={sliderIndex}
                onChange={(e) => {
                  setIsPlaying(false);
                  setSliderIndex(parseInt(e.target.value));
                }}
                className="w-full accent-[#facc15] bg-white/10 rounded-lg appearance-none h-1 cursor-pointer"
              />
            </div>
            <div className="text-[10px] font-mono text-white whitespace-nowrap bg-white/5 px-2 py-1 rounded">
              {edgeTimestamps[sliderIndex] ? new Date(edgeTimestamps[sliderIndex]).toLocaleString() : ''}
            </div>
          </div>
        </div>
      )}

      {/* Footer bar */}
      {isReady && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[10px] text-text-muted bg-[#0a0f1e]/95 px-3 py-1.5 rounded-lg border border-white/5">
          <span>
            {visibleVertices.length.toLocaleString()} nodes · {visibleEdges.length.toLocaleString()} edges
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
