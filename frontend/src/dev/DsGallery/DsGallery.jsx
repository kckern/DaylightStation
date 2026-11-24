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
  LoadingState, ErrorState, EmptyState, StateMessage, SectionCard, StatCard,
  DateStepper, Button, Select, UiIcon, ConfirmModal, FormDialog, ActionMenu,
  Toast, ToastRegion, Skeleton, TouchButton, SubmitButton, PlaybackFrame,
} from '../../lib/ui/index.js';

const tabs = [
  { id: 'controls', label: 'Controls', icon: <IconAdjustments aria-hidden="true" /> },
  { id: 'choices', label: 'Choices', icon: <IconListCheck aria-hidden="true" /> },
  { id: 'admin', label: 'Admin', href: '/admin', icon: <IconLayoutDashboard aria-hidden="true" /> },
];

// `primitives` names the lib/ui exports the block shows; DsGallery.test.jsx
// reads it to prove every visual primitive has a gallery entry.
function Demo({ primitives, children }) {
  return <div data-ds-demo={primitives}>{children}</div>;
}

function OverlayExamples() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState('');

  function save(event) {
    event.preventDefault();
    setSaving(true);
    setTimeout(() => { setSaving(false); setFormOpen(false); setLast(`Saved ${name || 'nothing'}`); }, 600);
  }

  return (
    <Demo primitives="ConfirmModal FormDialog ActionMenu SubmitButton">
      <SectionCard title="Dialogs and menus">
        <Group gap="var(--ds-space-sm)">
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>Delete item</Button>
          <Button variant="secondary" onClick={() => setFormOpen(true)}>Rename item</Button>
          <ActionMenu position="bottom-start" trigger={<Button variant="secondary">More actions</Button>}>
            <Menu.Item onClick={() => setLast('Duplicated')}>Duplicate</Menu.Item>
            <Menu.Item onClick={() => setLast('Archived')}>Archive</Menu.Item>
          </ActionMenu>
        </Group>
        {last && <p role="status">{last}</p>}
        <ConfirmModal opened={confirmOpen} onClose={() => setConfirmOpen(false)}
          onConfirm={() => { setConfirmOpen(false); setLast('Deleted'); }}
          title="Delete item" message="This cannot be undone." impact="One item will be removed." />
        <FormDialog opened={formOpen} onClose={() => !saving && setFormOpen(false)} title="Rename item" closeOnEscape={!saving}>
          <form onSubmit={save}>
            <Stack>
              <TextInput label="Name" value={name} onChange={event => setName(event.currentTarget.value)} data-autofocus />
              <SubmitButton pending={saving}>Save</SubmitButton>
            </Stack>
          </form>
        </FormDialog>
      </SectionCard>
    </Demo>
  );
}

function FeedbackExamples() {
  const [toasts, setToasts] = useState([]);
  const [count, setCount] = useState(0);

  function addToast(tone) {
    const id = count + 1;
    setCount(id);
    setToasts(list => [...list, { id, tone }]);
  }

  return (
    <>
      <Demo primitives="Toast ToastRegion">
        <SectionCard title="Toasts">
          <Group gap="var(--ds-space-sm)">
            <Button variant="secondary" onClick={() => addToast('info')}>Info toast</Button>
            <Button variant="secondary" onClick={() => addToast('error')}>Error toast</Button>
          </Group>
          <ToastRegion>
            {toasts.map(({ id, tone }) => (
              <Toast key={id} tone={tone} message={tone === 'error' ? 'Could not save.' : 'Saved.'}>
                <Button density="compact" variant="secondary" onClick={() => setToasts(list => list.filter(t => t.id !== id))}>Dismiss</Button>
              </Toast>
            ))}
          </ToastRegion>
        </SectionCard>
      </Demo>
      <Demo primitives="Skeleton">
        <SectionCard title="Skeleton">
          <Stack gap="var(--ds-space-sm)">
            <Skeleton height={14} width="60%" />
            <Skeleton height={14} />
            <Skeleton height={40} width={40} circle />
          </Stack>
        </SectionCard>
      </Demo>
      <Demo primitives="StateMessage">
        <SectionCard title="State message">
          <StateMessage state="unavailable" title="Camera unavailable" detail="Check the connection and try again." />
        </SectionCard>
      </Demo>
    </>
  );
}

function KioskExamples() {
  const [presses, setPresses] = useState(0);
  return (
    <>
      <Demo primitives="TouchButton">
        <SectionCard title="Touch button">
          <TouchButton onClick={() => setPresses(n => n + 1)}>Pressed {presses} times</TouchButton>
        </SectionCard>
      </Demo>
      <Demo primitives="PlaybackFrame">
        <SectionCard title="Playback frame">
          <PlaybackFrame header={<strong>Now playing</strong>} controls={<Button density="compact" variant="secondary">Pause</Button>}>
            <p>Content area</p>
          </PlaybackFrame>
        </SectionCard>
      </Demo>
    </>
  );
}

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
        <Demo primitives="AppThemeProvider AppChrome AppFrame DismissStackProvider">
        <AppChrome
          title="DS Gallery"
          tabs={tabs}
          activeTab={tab}
          onTabChange={setTab}
        >
          {tab === 'choices' ? <ChoiceExamples /> : (
            <div style={{ display: 'grid', gap: 'var(--ds-space-md)' }} data-testid="gallery-grid">
              <Demo primitives="SectionCard Button Select UiIcon Sheet"><SectionCard title="Controls">
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
              </SectionCard></Demo>
              <Demo primitives="LoadingState ErrorState EmptyState"><SectionCard title="States">
                <LoadingState label="demo" />
                {recovered
                  ? <p role="status">Section loaded</p>
                  : <ErrorState error={new Error('Example failure')} onRetry={() => setRecovered(true)} />}
                <EmptyState title="Nothing logged" hint="Add your first item"
                  action={{ label: 'Add', onClick: () => setSheetOpen(true) }} />
              </SectionCard></Demo>
              <Demo primitives="StatCard"><SectionCard title="Stats">
                <div style={{ display: 'flex', gap: 'var(--ds-space-md)', flexWrap: 'wrap' }}>
                  <StatCard label="Remaining" value={1140} unit="kcal" emphasis />
                  <StatCard label="Protein" value={82} unit="g" trend="▲ on pace" />
                </div>
              </SectionCard></Demo>
              <Demo primitives="DateStepper"><SectionCard title="Date">
                <DateStepper date={date} onChange={setDate} max="2026-09-02" />
              </SectionCard></Demo>
              <OverlayExamples />
              <FeedbackExamples />
              <KioskExamples />
            </div>
          )}
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Example sheet">
            <p>Sheet body content.</p>
          </Sheet>
        </AppChrome>
        </Demo>
      </DismissStackProvider>
    </AppThemeProvider>
  );
}
