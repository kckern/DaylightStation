import React, { useState } from 'react';
import { FullScreenContainer, AppButton } from '../../../../shared';
import ComponentCard from '../components/ComponentCard';

const ContainersSection = () => {
  const [bg, setBg] = useState('default');
  const [showFooter, setShowFooter] = useState(true);

  return (
    <div className="cs-demo-grid">
      <ComponentCard
        title="FullScreenContainer"
        description="Preview of header/footer slots with background presets."
      >
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <AppButton size="sm" variant={bg === 'default' ? 'primary' : 'ghost'} onClick={() => setBg('default')}>Default</AppButton>
            <AppButton size="sm" variant={bg === 'dark' ? 'primary' : 'ghost'} onClick={() => setBg('dark')}>Dark</AppButton>
            <AppButton size="sm" variant={bg === 'gradient' ? 'primary' : 'ghost'} onClick={() => setBg('gradient')}>Gradient</AppButton>
            <AppButton size="sm" variant={showFooter ? 'primary' : 'ghost'} onClick={() => setShowFooter((v) => !v)}>
              {showFooter ? 'Hide Footer' : 'Show Footer'}
            </AppButton>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
            <FullScreenContainer
              background={bg}
              showHeader
              showFooter={showFooter}
              headerContent={<div style={{ padding: '8px 12px' }}>Header slot</div>}
              footerContent={<div style={{ padding: '8px 12px' }}>Footer slot</div>}
              onExit={() => {}}
              exitOnEscape={false}
              style={{ minHeight: 220 }}
            >
              <div style={{ padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10 }}>Content area</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 10 }}>Left pane</div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 10 }}>Right pane</div>
                </div>
              </div>
            </FullScreenContainer>
          </div>
        </div>
      </ComponentCard>

      <ComponentCard
        title="Split Layout"
        description="Simple split preview to show layout scaffolding."
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 10, minHeight: 180 }}>
          <div style={{ background: 'rgba(79,195,247,0.08)', border: '1px solid rgba(79,195,247,0.3)', borderRadius: 10, padding: 12 }}>
            Primary pane
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12 }}>
            Secondary pane
          </div>
        </div>
      </ComponentCard>
    </div>
  );
};

export default ContainersSection;
