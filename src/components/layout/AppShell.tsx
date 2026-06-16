import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { StatusLine } from './StatusLine';
import { AiBar } from './AiBar';

export function AppShell({
  hasData,
  children,
}: {
  hasData: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen w-full bg-paper text-ink overflow-hidden">
      <TopBar hasData={hasData} />
      <div className="flex flex-1 min-h-0">
        <Sidebar hasData={hasData} />
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        {hasData && <AiBar />}
      </div>
      <StatusLine hasData={hasData} />
    </div>
  );
}
