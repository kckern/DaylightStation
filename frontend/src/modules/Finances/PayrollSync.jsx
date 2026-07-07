import { useState } from 'react';
import { Button, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';

const financeLogger = getChildLogger({ app: 'finance' });

const syncPayroll = (token) =>
  DaylightAPI('api/v1/finance/payroll/sync', token ? { token } : {}, 'POST');

export function PayrollSyncContent() {
  const [token, setToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const response = await syncPayroll(token);
      setResult(response);
      financeLogger.info('finance.payroll.sync.success', { response });
    } catch (err) {
      setError(err.message);
      financeLogger.error('finance.payroll.sync.error', { error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ padding: '1rem' }}>
      <p style={{ marginBottom: '1rem', color: '#666' }}>
        Enter your payroll session token to sync paychecks. Leave empty to use stored credentials.
      </p>
      <TextInput
        label="Session Token"
        placeholder="Paste token here (optional)"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={syncing}
        style={{ marginBottom: '1rem' }}
      />
      <Button onClick={handleSync} loading={syncing} disabled={syncing} fullWidth>
        {syncing ? 'Syncing...' : 'Sync Payroll'}
      </Button>
      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fee', borderRadius: 4, color: '#c00' }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#efe', borderRadius: 4, color: '#060' }}>
          Payroll synced successfully!
        </div>
      )}
    </div>
  );
}
