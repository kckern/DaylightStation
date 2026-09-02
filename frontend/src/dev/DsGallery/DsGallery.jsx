// frontend/src/dev/DsGallery/DsGallery.jsx
//
// Every DS primitive in every state on one page — the standing visual
// verification surface. Dev-only route; lazy-loaded so it never rides in
// the main bundle.
import { useState } from 'react';
import {
  AppThemeProvider, AppChrome, Sheet, DismissStackProvider,
  LoadingState, ErrorState, EmptyState, SectionCard, StatCard,
  DateStepper, AskAffordance,
} from '../../lib/ui/index.js';

const Dot = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export default function DsGallery() {
  const [tab, setTab] = useState('one');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [date, setDate] = useState('2026-09-01');

  return (
    <AppThemeProvider pack="health">
      <DismissStackProvider>
        <AppChrome
          title="DS Gallery"
          tabs={[
            { id: 'one', label: 'One', icon: <Dot /> },
            { id: 'two', label: 'Two', icon: <Dot /> },
          ]}
          activeTab={tab}
          onTabChange={setTab}
          footer={<AskAffordance onActivate={() => setSheetOpen(true)} />}
        >
          <div style={{ display: 'grid', gap: '0.75rem' }} data-testid="gallery-grid">
            <SectionCard title="States">
              <LoadingState label="demo" />
              <ErrorState error={new Error('Example failure')} onRetry={() => {}} />
              <EmptyState title="Nothing logged" hint="Add your first item"
                action={{ label: 'Add', onClick: () => {} }} />
            </SectionCard>
            <SectionCard title="Stats" actions={<button>edit</button>}>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <StatCard label="Remaining" value={1140} unit="kcal" emphasis />
                <StatCard label="Protein" value={82} unit="g" trend="▲ on pace" />
              </div>
            </SectionCard>
            <SectionCard title="Date">
              <DateStepper date={date} onChange={setDate} max="2026-09-02" />
            </SectionCard>
            <button onClick={() => setSheetOpen(true)}>Open sheet</button>
          </div>
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Example sheet">
            <p>Sheet body content.</p>
          </Sheet>
        </AppChrome>
      </DismissStackProvider>
    </AppThemeProvider>
  );
}
