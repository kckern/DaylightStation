// frontend/src/modules/Auth/SetupWizard.jsx
import { useState } from 'react';
import { Stack, TextInput, PasswordInput, Button, Text, Title, Paper, Stepper, Group } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import './Auth.scss';

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const canAdvance = () => {
    if (step === 0) return true; // Welcome
    if (step === 1) return username.length >= 2 && password.length >= 8 && password === confirmPassword;
    if (step === 2) return householdName.length >= 1;
    return false;
  };

  const handleFinish = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI('/api/v1/auth/setup', { username, password, householdName }, 'POST');
      setToken(result.token);
      setStep(3);
    } catch (err) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <Paper className="auth-card setup-card" p="xl" radius="md">
        <Stepper active={step} size="sm" mb="xl">
          <Stepper.Step label="Welcome" />
          <Stepper.Step label="Account" />
          <Stepper.Step label="Household" />
          <Stepper.Step label="Done" />
        </Stepper>

        {step === 0 && (
          <Stack align="center" gap="lg">
            <Title order={2}>DaylightStation</Title>
            <Text c="dimmed" ta="center">Welcome to your new station. Let's get you set up.</Text>
            <Button onClick={() => setStep(1)} size="lg">Get Started</Button>
          </Stack>
        )}

        {step === 1 && (
          <Stack gap="md">
            <Title order={3}>Create Admin Account</Title>
            <TextInput
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              placeholder="admin"
            />
            <PasswordInput
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="At least 8 characters"
            />
            <PasswordInput
              label="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              error={confirmPassword && password !== confirmPassword ? 'Passwords do not match' : null}
            />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Group justify="flex-end">
              <Button onClick={() => setStep(2)} disabled={!canAdvance()}>Next</Button>
            </Group>
          </Stack>
        )}

        {step === 2 && (
          <Stack gap="md">
            <Title order={3}>Name Your Household</Title>
            <TextInput
              label="Household Name"
              value={householdName}
              onChange={(e) => setHouseholdName(e.currentTarget.value)}
              placeholder="The Smith Family"
            />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleFinish} loading={loading} disabled={!canAdvance()}>Finish Setup</Button>
            </Group>
          </Stack>
        )}

        {step === 3 && (
          <Stack align="center" gap="lg">
            <Title order={3}>Your station is ready.</Title>
            <Text c="dimmed" ta="center">
              You can add members, devices, and configure apps from the Admin panel.
            </Text>
            <Button onClick={onComplete} size="lg">Go to Station</Button>
          </Stack>
        )}
      </Paper>
    </div>
  );
}
