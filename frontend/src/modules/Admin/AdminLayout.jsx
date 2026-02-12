import React from 'react';
import { Outlet } from 'react-router-dom';
import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import AdminNav from './AdminNav.jsx';
import AdminHeader from './AdminHeader.jsx';
import './Admin.scss';

function AdminLayout() {
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      className="admin-layout"
      header={{ height: 48 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding={0}
    >
      <AppShell.Header>
        <AdminHeader opened={opened} toggle={toggle} />
      </AppShell.Header>

      <AppShell.Navbar>
        <AdminNav />
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export default AdminLayout;
