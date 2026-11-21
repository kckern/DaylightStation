import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppFrame } from '../../lib/ui/AppFrame.jsx';
import { useCompactViewport } from '../../lib/ui/useCompactViewport.js';
import { DismissStackProvider } from '../../lib/ui/dismiss/DismissStackProvider.jsx';
import { keepTabInPanel } from '../../lib/ui/dismiss/useDialogFocus.js';
import AdminNav from './AdminNav.jsx';
import AdminHeader from './AdminHeader.jsx';
import { UnsavedGuardProvider } from './shared/UnsavedGuardContext.jsx';
import './Admin.scss';

function AdminLayout() {
  const { key } = useLocation();
  const compact = useCompactViewport();
  const [openAt, setOpenAt] = useState(null);
  const opened = compact && openAt === key;
  const opener = useRef(null);
  const content = useRef(null);
  const dismiss = useCallback(() => {
    setOpenAt(null);
    opener.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (openAt === null || opened) return;
    // A destination change hides the compact links, including the focused link.
    if (compact && key !== openAt) content.current?.focus({ preventScroll: true });
    setOpenAt(null);
  }, [compact, key, openAt, opened]);

  return (
    <UnsavedGuardProvider>
      <DismissStackProvider>
        <AppFrame
          className={opened ? 'admin-layout admin-layout--menu-open' : 'admin-layout'}
          onKeyDown={opened ? keepTabInPanel : undefined}
          header={<AdminHeader opened={opened} opener={opener} toggle={() => opened ? dismiss() : setOpenAt(key)} />}
          navigation={<AdminNav opened={opened} onDismiss={dismiss} />}
        >
          <div className="admin-content" ref={content} tabIndex={-1}><Outlet /></div>
        </AppFrame>
      </DismissStackProvider>
    </UnsavedGuardProvider>
  );
}

export default AdminLayout;
