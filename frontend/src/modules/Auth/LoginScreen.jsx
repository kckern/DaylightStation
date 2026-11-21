// frontend/src/modules/Auth/LoginScreen.jsx
import { useContext, useState } from 'react';
import { Stack, TextInput, Button, Text, Title, Paper, Alert } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import { ErrorState, LoadingState, useRetryRegion } from '../../lib/ui/index.js';
import { PublicAuthContext } from './PublicAuthContext.jsx';
import PasswordInput from './methods/PasswordInput.jsx';
import './Auth.scss';

export default function LoginScreen({ onLogin }) {
  const { data, error, pending, reload } = useContext(PublicAuthContext);
  const [formContext, setFormContext] = useState(data);
  // Keep the last accepted mode available while the next route check runs.
  if (data && data !== formContext) setFormContext(data);
  const { regionProps, retry } = useRetryRegion(reload, !formContext && pending);

  return <div className="auth-container">
    <Paper component="section" {...regionProps} aria-label="Sign-in setup" className="auth-card" p="xl" radius="md">
      {formContext ? <LoginForm context={formContext} onLogin={onLogin} />
        : error ? <ErrorState error={error} onRetry={retry} label="Sign-in setup" />
        : <LoadingState label="Sign-in setup" rows={2} />}
    </Paper>
  </div>;
}

function stepFor(setupAdmin) {
  if (setupAdmin === null) return 'login';
  return setupAdmin ? 'setup-password' : 'setup-username';
}

function LoginForm({ context, onLogin }) {
  const nextSetupAdmin = context.needsSetup ? context.setupAdmin ?? '' : null;
  const [setupAdmin, setSetupAdmin] = useState(nextSetupAdmin);
  const [username, setUsername] = useState(setupAdmin ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(() => stepFor(setupAdmin));

  if (!loading && setupAdmin !== nextSetupAdmin) {
    setSetupAdmin(nextSetupAdmin);
    // An accepted claim with a storage failure already moved into sign-in.
    if (nextSetupAdmin !== null || step !== 'login') {
      setStep(stepFor(nextSetupAdmin));
      setUsername(nextSetupAdmin ?? '');
      setPassword('');
      setError(null);
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (step === 'setup-username') {
      setStep('setup-password');
      return;
    }

    const claiming = step === 'setup-password';
    setLoading(true);
    let result;
    try {
      result = await DaylightAPI(claiming ? '/api/v1/auth/claim' : '/api/v1/auth/token', { username, password }, 'POST');
    } catch {
      if (claiming) {
        setError('Username not found. Check and try again.');
        setStep('setup-username');
        setPassword('');
      } else {
        setError('Invalid username or password');
      }
      return;
    } finally {
      setLoading(false);
    }

    try {
      setToken(result.token);
    } catch {
      setStep('login');
      setPassword('');
      const accepted = claiming ? 'Your password was set.' : 'Your sign-in was accepted.';
      setError(accepted + ' This browser could not save your session. Allow site storage or free up space, then sign in again.');
      return;
    }
    onLogin?.();
  };

  const isSetup = step === 'setup-username' || step === 'setup-password';
  const subtitle = isSetup ? 'First-Time Setup' : 'DaylightStation';

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="md" align="center">
        <Title order={3}>{context.householdName || 'DaylightStation'}</Title>
        <Text c="dimmed" size="sm">{subtitle}</Text>

        {step === 'setup-password' ? (
          <Text size="sm" w="100%">
            Setting password for <strong>{username}</strong>
          </Text>
        ) : (
          <TextInput
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            w="100%"
          />
        )}

        {step !== 'setup-username' && (
          <div style={{ width: '100%' }}>
            <PasswordInput
              value={password}
              onChange={setPassword}
              label={step === 'setup-password' ? 'Choose a Password' : undefined}
            />
          </div>
        )}

        {error && <Alert color="red" w="100%">{error}</Alert>}

        <Button
          type="submit"
          loading={loading}
          fullWidth
          disabled={
            step === 'setup-username' ? !username :
            step === 'setup-password' ? !password :
            !username || !password
          }
        >
          {step === 'setup-username' ? 'Continue' :
           step === 'setup-password' ? 'Set Password & Sign In' :
           'Sign In'}
        </Button>
      </Stack>
    </form>
  );
}
