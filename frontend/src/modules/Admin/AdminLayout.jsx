import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppFrame } from '../../lib/ui/AppFrame.jsx';
import { useDisclosure } from '@mantine/hooks';
import AdminNav from './AdminNav.jsx';
import AdminHeader from './AdminHeader.jsx';
import { UnsavedGuardProvider } from './shared/UnsavedGuardContext.jsx';
import './Admin.scss';

function AdminLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  React.useEffect(close, [pathname, close]);

  return (
    <UnsavedGuardProvider>
      <AppFrame
        className={opened ? 'admin-layout admin-layout--menu-open' : 'admin-layout'}
        header={<AdminHeader opened={opened} toggle={toggle} />}
        navigation={<AdminNav />}
      >
        <div className="admin-content"><Outlet /></div>
      </AppFrame>
    </UnsavedGuardProvider>
  );
}

export default AdminLayout;
