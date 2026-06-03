import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import LandingPage from './pages/LandingPage';
import AnalysisDashboard from './pages/AnalysisDashboard';
import LoadingOverlay from './components/LoadingOverlay';
import { useSocialData } from './hooks/useSocialData';

function App() {
  const {
    graphData,
    computedMetrics,
    aiInsights,
    filteredData,
    isLoading,
    filters,
    processingStage,
    processFile,
    updateFilters,
    resetFilters,
    loadDemo,
    goToLandingPage,
  } = useSocialData();

  return (
    <div className="flex flex-col h-screen w-full bg-[#050a14] text-text-primary overflow-hidden">
      <LoadingOverlay
        isVisible={isLoading}
        stage={processingStage.stage}
        subStage=""
        progress={processingStage.progress}
      />

      <TopBar
        datasetId={null}
        onLogoClick={goToLandingPage}
        graphData={graphData}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          filters={filters}
          onFilterChange={updateFilters}
          onResetFilters={resetFilters}
          isDataLoaded={!!graphData}
          onFileProcessed={processFile}
          graphData={graphData}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative custom-scrollbar">
          {!graphData ? (
            <LandingPage
              onFileProcessed={processFile}
              onLoadDemo={loadDemo}
              isLoading={isLoading}
            />
          ) : computedMetrics && (
            <AnalysisDashboard
              graphData={graphData}
              computedMetrics={computedMetrics}
              aiInsights={aiInsights}
              filteredData={filteredData}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
