import React from 'react';
import { Download } from 'lucide-react';
import simelogo from '../../simelogo.jpeg';
import { GraphData } from '../engine/engineTypes';

interface TopBarProps {
  datasetId?: number | null;
  onLogoClick: () => void;
  graphData?: GraphData | null;
}

const TopBar: React.FC<TopBarProps> = ({ onLogoClick, graphData }) => {
  const handleExport = () => {
    if (!graphData) return;
    const csv = [
      'Vertex,Label,Degree,Betweenness,PageRank,Clustering,Cluster,Sentiment,Followers',
      ...graphData.vertices.map(v =>
        `${v.id},${v.label},${v.degree},${v.betweenness},${v.pagerank},${v.clusteringCoefficient},${v.cluster},${v.sentiment},${v.followers}`
      )
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simelab_metrics_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-bg-primary/80 backdrop-blur-md z-30">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onLogoClick}
          aria-label="Go to landing page"
          className="w-10 h-10 rounded overflow-hidden flex items-center justify-center"
        >
          <img src={simelogo} alt="SIME Logo" className="w-full h-full object-cover" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-white leading-tight">SIMElab Data Explorer</h1>
          <p className="text-[10px] text-text-muted font-medium opacity-70">Social Intelligence Platform v5.0</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_10px_#10b981] ${graphData ? 'bg-[#10b981]' : 'bg-[#64748b]'}`} />
          <span className="text-[10px] text-text-muted font-bold">
            {graphData ? `${graphData.vertices.length} nodes` : 'No data'}
          </span>
        </div>
        <button
          onClick={handleExport}
          disabled={!graphData}
          className="bg-accent-secondary hover:bg-yellow-500 text-bg-primary font-bold py-2 px-5 rounded-lg flex items-center gap-2 text-xs transition-all active:scale-95 shadow-lg shadow-yellow-500/10 disabled:opacity-50"
        >
          <Download size={14} className="stroke-[3]" />
          Export Metrics CSV
        </button>
      </div>
    </header>
  );
};

export default TopBar;
