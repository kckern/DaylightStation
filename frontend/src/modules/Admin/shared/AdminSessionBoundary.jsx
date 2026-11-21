import React from 'react';
import AuthGate from '../../Auth/AuthGate.jsx';
import { useAdminSessionKey } from './useAdminSessionKey.js';

/** Remount Admin UI whenever its authenticated session changes. */
export default function AdminSessionBoundary({ children }) {
  const sessionKey = useAdminSessionKey();
  return (
    <React.Fragment key={sessionKey}>
      <AuthGate app="admin">{children}</AuthGate>
    </React.Fragment>
  );
}
