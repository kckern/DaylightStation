// frontend/src/dev/DsGallery/DsGallery.jsx
//
// Every DS primitive in every state on one page — the standing visual
// verification surface. Dev-only route; lazy-loaded so it never rides in
// the main bundle.
import { useState } from 'react';
import { Checkbox, Chip, Group, Menu, Radio, Stack, TextInput } from '@mantine/core';
import { IconAdjustments, IconLayoutDashboard, IconListCheck } from '@tabler/icons-react';
import {
  AppThemeProvider, AppChrome, Sheet, DismissStackProvider,
  LoadingState, ErrorState, EmptyState, SectionCard, StatCard,
  DateStepper, Button, Select, UiIcon,
} from '../../lib/ui/index.js';

const tabs = [
  { id: 'controls', label: 'Controls', icon: <IconAdjustments aria-hidden="true" /> },
  { id: 'choices', label: 'Choices', icon: <IconListCheck aria-hidden="true" /> },
  { id: 'admin', label: 'Admin', href: '/admin', icon: <IconLayoutDashboard aria-hidden="true" /> },
];

function ChoiceExamples() {
  const [order, setOrder] = useState('recent');
  const [sources, setSources] = useState([]);
  const [savedOnly, setSavedOnly] = useState(false);

  function resetChoices() {
    setOrder('recent');
    setSources([]);
    setSavedOnly(false);
  }

  return (
    <SectionCard title="Collection filters" actions={
      <Menu position="bottom-end">
        <Menu.Target><Button density="compact" variant="secondary">Filter actions</Button></Menu.Target>
        <Menu.Dropdown><Menu.Item onClick={resetChoices}>Reset filters</Menu.Item></Menu.Dropdown>
      </Menu>
    }>
      <Stack>
        <Radio.Group label="Sort order" value={order} onChange={setOrder}>
          <Group><Radio value="recent" label="Recently added" /><Radio value="title" label="Title" /></Group>
        </Radio.Group>
        <fieldset>
          <legend>Sources</legend>
          <Chip.Group multiple value={sources} onChange={setSources}>
            <Group><Chip value="library">Library</Chip><Chip value="feed">Feed</Chip></Group>
          </Chip.Group>
        </fieldset>
        <Checkbox label="Saved items only" checked={savedOnly} onChange={event => setSavedOnly(event.currentTarget.checked)} />
      </Stack>
    </SectionCard>
  );
}

export default function DsGallery() {
  const [tab, setTab] = useState('controls');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [filterTouched, setFilterTouched] = useState(false);
  const [density, setDensity] = useState('compact');
  const [recovered, setRecovered] = useState(false);
  const [date, setDate] = useState('2026-09-01');

  return (
    <AppThemeProvider pack="health">
      <DismissStackProvider>
        <AppChrome
          title="DS Gallery"
          tabs={tabs}
          activeTab={tab}
          onTabChange={setTab}
        >
          {tab === 'choices' ? <ChoiceExamples /> : (
            <div style={{ display: 'grid', gap: 'var(--ds-space-md)' }} data-testid="gallery-grid">
              <SectionCard title="Controls">
                <Stack gap="var(--ds-space-sm)">
                  <TextInput label="Search term" description="Use at least two characters."
                    leftSection={<UiIcon name="search" />} value={filter}
                    onChange={event => setFilter(event.currentTarget.value)}
                    onBlur={() => setFilterTouched(true)}
                    error={filterTouched && filter.trim().length === 1 ? 'Enter another character.' : undefined} />
                  <label>Density <Select density="compact" value={density} onChange={event => setDensity(event.target.value)}>
                    <option value="compact">Compact</option>
                    <option value="touch">Comfortable</option>
                  </Select></label>
                  <Group gap="var(--ds-space-sm)">
                    <Button density={density} onClick={() => setSheetOpen(true)}>Open sheet</Button>
                    <Button density={density} busy>Saving</Button>
                  </Group>
                </Stack>
              </SectionCard>
              <SectionCard title="States">
                <LoadingState label="demo" />
                {recovered
                  ? <p role="status">Section loaded</p>
                  : <ErrorState error={new Error('Example failure')} onRetry={() => setRecovered(true)} />}
                <EmptyState title="Nothing logged" hint="Add your first item"
                  action={{ label: 'Add', onClick: () => setSheetOpen(true) }} />
              </SectionCard>
              <SectionCard title="Stats">
                <div style={{ display: 'flex', gap: 'var(--ds-space-md)', flexWrap: 'wrap' }}>
                  <StatCard label="Remaining" value={1140} unit="kcal" emphasis />
                  <StatCard label="Protein" value={82} unit="g" trend="▲ on pace" />
                </div>
              </SectionCard>
              <SectionCard title="Date">
                <DateStepper date={date} onChange={setDate} max="2026-09-02" />
              </SectionCard>
            </div>
          )}
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Example sheet">
            <p>Sheet body content.</p>
          </Sheet>
        </AppChrome>
      </DismissStackProvider>
    </AppThemeProvider>
  );
}
