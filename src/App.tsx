import React, { useEffect } from 'react';
import { LoadingOverlay } from './components/layout/LoadingOverlay';
import { LandingPage } from './pages/LandingPage';
import { OverviewPage } from './pages/OverviewPage';
import { NetworkPage } from './pages/NetworkPage';
import { SentimentPage } from './pages/SentimentPage';
import { DisinfoPage } from './pages/DisinfoPage';
import { HashtagsPage } from './pages/HashtagsPage';
import { CensorshipPage } from './pages/CensorshipPage';
import { DriftPage } from './pages/DriftPage';
import { ReportPage } from './pages/ReportPage';
import { DocsPage } from './pages/DocsPage';
import { AccountDrawer } from './components/insights/AccountDrawer';
import { AppShell } from './components/layout/AppShell';
import { useUrlState } from './app/useUrlState';
import { useSocialData } from './hooks/useSocialData';
import { getBackendLLMConfig } from './services/pythonApi';

const App: React.FC = () => {
  const { route } = useUrlState();
  const { graphData } = useSocialData();

  useEffect(() => {
    // Sync LLM config
    getBackendLLMConfig()
      .then((cfg) => {
        if (cfg?.apiKey) {
          localStorage.setItem('simelab_llm_provider', cfg.provider);
          localStorage.setItem('simelab_llm_key', cfg.apiKey);
        }
      })
      .catch(() => {});

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
      <div className="h-screen w-full bg-paper text-ink flex flex-col overflow-y-auto">
        <LoadingOverlay />
        {route.name === 'docs' ? <DocsPage /> : <LandingPage />}
      </div>
    );
  }

  return (
    <>
      <LoadingOverlay />
      <AppShell hasData={hasData}>
        {renderPage(route.name)}
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
      case 'report': return <ReportPage />;
      case 'docs': return <DocsPage />;
      case 'overview':
      case 'account':
      default:
        return <OverviewPage />;
    }
  }
};

export default App;
