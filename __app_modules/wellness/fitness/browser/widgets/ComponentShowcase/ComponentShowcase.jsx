import React, { useEffect, useMemo, useState } from 'react';
import useFitnessModule from "../../player/useFitnessModule.js";
import CategoryNav from "./components/CategoryNav.jsx";
import QuickToolsDrawer from "./components/QuickToolsDrawer.jsx";
import {
  LiveContextSection,
  PrimitivesSection,
  CompositesSection,
  ContainersSection,
  IntegrationsSection,
  HooksSection
} from "./sections/index.js";
import { primitiveComponents } from "./data/componentDefs.js";
import "./ComponentShowcase.scss";

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

const ComponentShowcase = ({ mode = 'standalone', onClose: _onClose, onMount }) => {
  const { sessionActive } = useFitnessModule('component_showcase');
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
