import React from 'react';
import { FilterState } from '../hooks/useSocialData';
import { GraphData } from '../engine/engineTypes';
import {
  Calendar, ChevronRight, RotateCcw, Upload, CheckCircle2
} from 'lucide-react';

interface SidebarProps {
  filters: FilterState;
  onFilterChange: (newFilters: Partial<FilterState>) => void;
  onResetFilters: () => void;
  isDataLoaded: boolean;
  onFileProcessed: (file: File) => void;
  graphData?: GraphData | null;
}

const Sidebar: React.FC<SidebarProps> = ({
  filters, onFilterChange, onResetFilters, isDataLoaded, onFileProcessed, graphData
}) => {
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dateFromRef = React.useRef<HTMLInputElement>(null);
  const dateToRef = React.useRef<HTMLInputElement>(null);

  // Get unique clusters, platforms, topics for filters
  const clusters = React.useMemo(() => {
    if (!graphData) return [];
    const set = new Set<number>();
    graphData.vertices.forEach(v => set.add(v.cluster));
    return [...set].sort((a, b) => a - b);
  }, [graphData]);

  const platforms = React.useMemo(() => {
    if (!graphData) return [];
    return [...new Set(graphData.vertices.map(v => v.platform).filter(Boolean))];
  }, [graphData]);

  const handleManualFilterChange = (newFilters: Partial<FilterState>) => {
    onFilterChange(newFilters);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.name.endsWith('.xlsx'))) {
      onFileProcessed(droppedFile);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) onFileProcessed(selectedFile);
  };

  return (
    <aside className="w-[300px] h-[calc(100vh-64px)] bg-[#050a14] border-r border-white/5 flex flex-col overflow-y-auto custom-scrollbar">
      <div className="p-4 space-y-6">
        {!isDataLoaded && (
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">Upload File</span>
                <div className="h-[1px] flex-1 bg-white/5" />
              </div>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".csv,.xlsx" />
              <div
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all duration-300 ${isDragging
                    ? 'border-accent-secondary bg-accent-secondary/10 scale-[1.02]'
                    : 'border-accent-secondary/30 bg-accent-secondary/5 hover:border-accent-secondary/50'
                  }`}
              >
                <div className="w-10 h-10 bg-accent-secondary/20 rounded-lg flex items-center justify-center">
                  <Upload className="text-accent-secondary" size={20} />
                </div>
                <span className="text-sm font-bold text-white">Drop CSV/XLSX Here</span>
                <p className="text-[10px] text-text-muted text-center">NodeXL export or any social data</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4 space-y-2 border border-white/5">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={12} className="text-accent-secondary mt-0.5" />
                  <p className="text-[10px] text-text-secondary">Auto-detects all NodeXL columns</p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={12} className="text-accent-secondary mt-0.5" />
                  <p className="text-[10px] text-text-secondary">Computes 8 SNA metrics in-browser</p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={12} className="text-accent-secondary mt-0.5" />
                  <p className="text-[10px] text-text-secondary">Louvain community detection</p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={12} className="text-accent-secondary mt-0.5" />
                  <p className="text-[10px] text-text-secondary">AI-powered insights & bot detection</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FILTERS */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">Filters</span>
            <div className="h-[1px] flex-1 bg-white/5" />
          </div>

          {/* Keyword */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-text-muted uppercase px-1">Search</label>
            <input type="text" value={filters.keyword}
              onChange={(e) => handleManualFilterChange({ keyword: e.target.value })}
              placeholder="Account, hashtag, or text..."
              className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-white focus:outline-none focus:border-accent-primary" />
          </div>

          {/* Sort By */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-text-muted uppercase px-1">Sort By</label>
            <div className="relative">
              <select value={filters.sortBy}
                onChange={(e) => handleManualFilterChange({ sortBy: e.target.value })}
                className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-white focus:outline-none appearance-none">
                <option>Degree</option>
                <option>Betweenness</option>
                <option>PageRank</option>
                <option>Followers</option>
                <option>Clustering</option>
                <option>Date</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
                <ChevronRight className="rotate-90" size={16} />
              </div>
            </div>
          </div>

          {/* Sentiment */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-text-muted uppercase px-1">Sentiment</label>
            <div className="relative">
              <select
                value={filters.sentiment.length === 3 ? 'All' : filters.sentiment[0]}
                onChange={(e) => {
                  const val = e.target.value;
                  handleManualFilterChange({
                    sentiment: val === 'All' ? ['Pos', 'Neu', 'Neg'] : [val as 'Pos' | 'Neu' | 'Neg']
                  });
                }}
                className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-white focus:outline-none appearance-none">
                <option value="All">All Sentiments</option>
                <option value="Pos">Positive</option>
                <option value="Neu">Neutral</option>
                <option value="Neg">Negative</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
                <ChevronRight className="rotate-90" size={16} />
              </div>
            </div>
          </div>

          {/* Cluster Filter */}
          {clusters.length > 1 && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase px-1">Community</label>
              <div className="relative">
                <select value={filters.selectedCluster}
                  onChange={(e) => handleManualFilterChange({ selectedCluster: parseInt(e.target.value) })}
                  className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-white focus:outline-none appearance-none">
                  <option value={-1}>All Communities</option>
                  {clusters.map(c => (
                    <option key={c} value={c}>Community {c + 1}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
                  <ChevronRight className="rotate-90" size={16} />
                </div>
              </div>
            </div>
          )}

          {/* Platform */}
          {platforms.length > 0 && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase px-1">Platform</label>
              <div className="relative">
                <select value={filters.platform}
                  onChange={(e) => handleManualFilterChange({ platform: e.target.value })}
                  className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-white focus:outline-none appearance-none">
                  <option>All Platforms</option>
                  {platforms.map(p => <option key={p}>{p}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
                  <ChevronRight className="rotate-90" size={16} />
                </div>
              </div>
            </div>
          )}

          {/* Min Followers */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-text-muted uppercase px-1">Min Followers</label>
            <input type="number" value={filters.minFollowers}
              onChange={(e) => handleManualFilterChange({ minFollowers: parseInt(e.target.value) || 0 })}
              placeholder="e.g. 1000"
              className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-white focus:outline-none focus:border-accent-primary" />
          </div>

          {/* Min Degree */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-text-muted uppercase px-1">Min Connections</label>
            <input type="number" value={filters.minDegree}
              onChange={(e) => handleManualFilterChange({ minDegree: parseInt(e.target.value) || 0 })}
              placeholder="e.g. 5"
              className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-white focus:outline-none focus:border-accent-primary" />
          </div>

          {/* Date Filters */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-text-muted uppercase px-1">Date From</label>
            <div className="relative group">
              <input type="date" ref={dateFromRef} value={filters.dateRange[0]}
                onChange={(e) => handleManualFilterChange({ dateRange: [e.target.value, filters.dateRange[1]] })}
                className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-text-secondary focus:outline-none focus:border-accent-secondary transition-colors appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
              <Calendar onClick={() => { try { dateFromRef.current?.showPicker(); } catch (_) { dateFromRef.current?.focus(); } }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted group-hover:text-accent-secondary cursor-pointer transition-colors" size={16} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-text-muted uppercase px-1">Date To</label>
            <div className="relative group">
              <input type="date" ref={dateToRef} value={filters.dateRange[1]}
                onChange={(e) => handleManualFilterChange({ dateRange: [filters.dateRange[0], e.target.value] })}
                className="w-full bg-[#0a1120] border border-white/10 rounded-lg py-3 px-3 text-sm text-text-secondary focus:outline-none focus:border-accent-secondary transition-colors appearance-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
              <Calendar onClick={() => { try { dateToRef.current?.showPicker(); } catch (_) { dateToRef.current?.focus(); } }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted group-hover:text-accent-secondary cursor-pointer transition-colors" size={16} />
            </div>
          </div>

          {/* Reset */}
          <button onClick={onResetFilters}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#111a2e] border border-white/10 rounded-lg text-xs font-bold text-white hover:bg-white/5 transition-all active:scale-[0.98]">
            <RotateCcw size={14} className="stroke-[2.5]" />
            Reset All Filters
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
