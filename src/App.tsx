import React, { lazy, Suspense, useEffect, useState } from 'react';
import { LoadingOverlay } from './components/layout/LoadingOverlay';
import { AccountDrawer } from './components/insights/AccountDrawer';
import { AppShell } from './components/layout/AppShell';
import { useUrlState } from './app/useUrlState';
import { useSocialData } from './hooks/useSocialData';
import { getBackendLLMConfig } from './services/pythonApi';
import { ThemeToggle } from './components/layout/ThemeToggle';
import { setBackendConfig } from './services/llmService';

const LandingPage = lazy(() => import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })));
const NetworkPage = lazy(() => import('./pages/NetworkPage').then((module) => ({ default: module.NetworkPage })));
const SentimentPage = lazy(() => import('./pages/SentimentPage').then((module) => ({ default: module.SentimentPage })));
const DisinfoPage = lazy(() => import('./pages/DisinfoPage').then((module) => ({ default: module.DisinfoPage })));
const HashtagsPage = lazy(() => import('./pages/HashtagsPage').then((module) => ({ default: module.HashtagsPage })));
const CensorshipPage = lazy(() => import('./pages/CensorshipPage').then((module) => ({ default: module.CensorshipPage })));
const DriftPage = lazy(() => import('./pages/DriftPage').then((module) => ({ default: module.DriftPage })));
const ReportPage = lazy(() => import('./pages/ReportPage').then((module) => ({ default: module.ReportPage })));
const DocsPage = lazy(() => import('./pages/DocsPage').then((module) => ({ default: module.DocsPage })));
const CommercialPage = lazy(() => import('./pages/CommercialPage').then((module) => ({ default: module.CommercialPage })));

const App: React.FC = () => {
  const { route } = useUrlState();
  const { graphData } = useSocialData();
  const [, setConfigVersion] = useState(0);

  useEffect(() => {
    // Sync LLM config
    getBackendLLMConfig()
      .then((cfg) => {
        setBackendConfig(cfg);
        setConfigVersion((value) => value + 1);
      })
      .catch(() => { });

    // Sync theme
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const onLanding = route.name === 'landing' || !graphData;
  const hasData = !!graphData;

  if (onLanding) {
    return (
      <div className="h-screen w-full bg-paper text-ink flex flex-col overflow-y-auto relative">
        <LoadingOverlay />
        <div className="absolute top-4 right-4 z-40">
          <ThemeToggle />
        </div>
        <Suspense fallback={<RouteFallback />}>
          {route.name === 'docs' ? <DocsPage /> : <LandingPage />}
        </Suspense>
      </div>
    );
  }

  return (
    <>
      <LoadingOverlay />
      <AppShell hasData={hasData}>
        <Suspense fallback={<RouteFallback />}>{renderPage(route.name)}</Suspense>
        <AccountDrawer />
      </AppShell>
    </>
  );

  function renderPage(name: string) {
    switch (name) {
      case 'network': return <NetworkPage />;
      case 'sentiment': return <SentimentPage />;
      case 'disinfo': return <DisinfoPage />;
      case 'hashtags': return <HashtagsPage />;
      case 'censorship': return <CensorshipPage />;
      case 'drift': return <DriftPage />;
      case 'commercial': return <CommercialPage />;
      case 'report': return <ReportPage />;
      case 'docs': return <DocsPage />;
      case 'overview':
      case 'account':
      default:
        return <OverviewPage />;
    }
  }
};

function RouteFallback() {
  return <div className="h-full min-h-64 grid place-items-center text-sm text-ink-mute">Loading view…</div>;
}

export default App;
