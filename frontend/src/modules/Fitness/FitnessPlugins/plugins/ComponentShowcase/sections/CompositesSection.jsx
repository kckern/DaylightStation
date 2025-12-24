import React, { useMemo, useState } from 'react';
import { ActionBar, AppNavigation, AppList, ConfirmDialog, AppModal, MultiChoice, AppButton } from '../../../../shared';
import useFitnessPlugin from '../../../useFitnessPlugin';
import ComponentCard from '../components/ComponentCard';

const CompositesSection = () => {
  const { participants = [], zones = [] } = useFitnessPlugin('component_showcase');
  const [step, setStep] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState([]);

  const rosterItems = useMemo(() => {
    if (participants.length === 0) {
      return [
        { id: 'demo-1', title: 'Demo User', subtitle: 'No live roster', icon: '👤' },
        { id: 'demo-2', title: 'Placeholder', subtitle: 'Tap to select', icon: '👥' }
      ];
    }
    return participants.map((p) => ({
      id: p.id || p.profileId || p.name,
      title: p.displayLabel || p.name || 'Participant',
      subtitle: p.zone ? `Zone ${p.zone}` : undefined,
      icon: p.avatarUrl ? <img src={p.avatarUrl} alt={p.name} style={{ width: 28, height: 28, borderRadius: 12 }} /> : '🏃'
    }));
  }, [participants]);

  const zoneOptions = useMemo(() => {
    if (zones.length) return zones.map((z) => ({ value: z.id || z.zone || z.name, label: z.name || `Zone ${z.id}` }));
    return [
      { value: 'cool', label: 'Cool' },
      { value: 'warm', label: 'Warm' },
      { value: 'fire', label: 'Fire' }
    ];
  }, [zones]);

  return (
    <div className="cs-demo-grid">
      <ComponentCard
        title="ActionBar"
        description="Quick actions with primary/ghost mix."
      >
        <div style={{ position: 'relative', minHeight: 60 }}>
          <ActionBar
            position="bottom"
            variant="transparent"
            primaryAction={{ label: 'Start', onClick: () => {} }}
            secondaryActions={[
              { label: 'Pause', onClick: () => {}, icon: '⏸' },
              { label: 'Reset', onClick: () => {}, icon: '⟳' }
            ]}
            rightContent={<span style={{ color: 'var(--cs-text-muted)', fontSize: 12 }}>Live toolbar</span>}
            safeArea={false}
          />
        </div>
      </ComponentCard>

      <ComponentCard
        title="AppNavigation"
        description="Stepper navigation demo."
      >
        <AppNavigation
          variant="stepper"
          items={['Warmup', 'Main', 'Cooldown']}
          activeIndex={step}
          onChange={setStep}
          position="top"
        />
      </ComponentCard>

      <ComponentCard
        title="AppList"
        description="Roster-driven list with fallback demo data."
      >
        <AppList
          items={rosterItems}
          onItemClick={() => setModalOpen(true)}
          emptyMessage="No participants"
        />
      </ComponentCard>

      <ComponentCard
        title="ConfirmDialog"
        description="Danger preset for destructive actions."
      >
        <AppButton variant="danger" onClick={() => setConfirmOpen(true)}>Delete Session</AppButton>
        <ConfirmDialog
          isOpen={confirmOpen}
          variant="danger"
          title="Delete session?"
          message="This cannot be undone."
          onConfirm={() => setConfirmOpen(false)}
          onCancel={() => setConfirmOpen(false)}
        />
      </ComponentCard>

      <ComponentCard
        title="AppModal"
        description="Simple modal with footer actions."
      >
        <AppButton onClick={() => setModalOpen(true)}>Open Modal</AppButton>
        <AppModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Modal Title"
          subtitle="Optional subtitle"
          footer={(
            <div style={{ display: 'flex', gap: 8 }}>
              <AppButton variant="ghost" onClick={() => setModalOpen(false)}>Close</AppButton>
              <AppButton onClick={() => setModalOpen(false)}>Save</AppButton>
            </div>
          )}
        >
          <p style={{ margin: 0 }}>Custom content goes here.</p>
        </AppModal>
      </ComponentCard>

      <ComponentCard
        title="MultiChoice"
        description="Zone selector using live zone config when available."
      >
        <MultiChoice
          options={zoneOptions}
          value={selectedZone}
          onChange={setSelectedZone}
          layout="grid"
          multiSelect
          columns={3}
        />
      </ComponentCard>
    </div>
  );
};

export default CompositesSection;
