import React, { useEffect, useMemo, useState } from 'react';
import useFitnessPlugin from '../../useFitnessPlugin';
import CategoryNav from './components/CategoryNav';
import QuickToolsDrawer from './components/QuickToolsDrawer';
import {
  LiveContextSection,
  PrimitivesSection,
  CompositesSection,
  ContainersSection,
  IntegrationsSection,
  HooksSection
} from './sections';
import { primitiveComponents } from './data/componentDefs';
import './ComponentShowcase.scss';

const TABS = [
  { id: 'live', label: 'Live Context' },
  { id: 'primitives', label: 'Primitives' },
  { id: 'composites', label: 'Composites' },
  { id: 'containers', label: 'Containers' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'hooks', label: 'Hooks' }
];

const SECTION_COMPONENTS = {
  live: LiveContextSection,
  primitives: PrimitivesSection,
  composites: CompositesSection,
  containers: ContainersSection,
  integrations: IntegrationsSection,
  hooks: HooksSection
};

const ComponentShowcase = ({ mode = 'standalone', onClose, onMount }) => {
  const { sessionActive } = useFitnessPlugin('component_showcase');
  const [activeTab, setActiveTab] = useState(TABS[0].id);

  useEffect(() => {
    onMount?.();
  }, [onMount]);

  const activeTabId = useMemo(() => TABS.find((tab) => tab.id === activeTab)?.id || TABS[0].id, [activeTab]);
  const ActiveSection = SECTION_COMPONENTS[activeTabId] || LiveContextSection;

  return (
    <div className={`component-showcase mode-${mode}`}>
      <div className="cs-content">
        <ActiveSection sessionActive={sessionActive} components={{ primitives: primitiveComponents }} />
      </div>

      <CategoryNav
        tabs={TABS}
        activeTab={activeTabId}
        onChange={(tabId) => setActiveTab(tabId)}
      />

      <QuickToolsDrawer />
    </div>
  );
};

export default ComponentShowcase;
