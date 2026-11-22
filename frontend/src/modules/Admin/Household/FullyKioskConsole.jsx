import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRefreshableRead } from '../../../lib/hooks/useRefreshableRead.js';
import { useVisibleRefresh } from '../../../lib/hooks/useVisibleRefresh.js';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Code,
  Divider,
  Grid,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowBack,
  IconBulb,
  IconDeviceDesktopCog,
  IconDownload,
  IconExternalLink,
  IconMessage,
  IconPhoto,
  IconPlayerPlay,
  IconRefresh,
  IconReload,
  IconSettings,
  IconVolume,
} from '@tabler/icons-react';
import { ConfirmModal } from '@/lib/ui/ConfirmModal.jsx';
import { notifyFailure, notifySuccess } from '../shared/feedback.js';
import fullyKioskAdminApi from './fullyKioskAdminApi.js';
import './FullyKioskConsole.scss';

// One console serves both kiosk providers. A device on the DaylightStation
// Android kiosk app reports `provider: 'daylight-android'` in its status and
// gets neutral wording; anything else is a Fully Kiosk device, worded as before.
const DAYLIGHT_ANDROID = 'daylight-android';

function wordingFor(provider) {
  return provider === DAYLIGHT_ANDROID
    ? {
      product: 'Kiosk',
      restartApp: ['Restart the kiosk app?', 'The kiosk app will briefly leave and restart the current page.', 'Restart app'],
      reboot: 'Reboot is sent through the kiosk app. The device may drop the request while it restarts.',
    }
    : {
      product: 'Fully Kiosk',
      restartApp: ['Restart Fully Kiosk?', 'Fully Kiosk will briefly leave and restart the current page.', 'Restart app'],
      reboot: 'Reboot is sent through Fully Kiosk. The device may drop the request while it restarts.',
    };
}

const CONFIRMATIONS = Object.freeze({
  'reset-webview': ['Reset WebView?', 'The current page renderer will be recreated.', 'Reset WebView'],
  'kiosk-unlock': ['Unlock kiosk mode?', 'This allows someone at the device to leave the kiosk experience.', 'Unlock kiosk'],
  'maintenance-enable': ['Enable maintenance mode?', 'This exposes device maintenance controls at the kiosk.', 'Enable maintenance'],
  reboot: ['Reboot device?', 'The device will be unavailable for about a minute.', 'Reboot'],
});

function humanize(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, value => value.toUpperCase());
}

function reported(value, suffix = '') {
  if (value === null || value === undefined || value === '') return 'Not reported';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return `${value}${suffix}`;
}

function formatBytes(value) {
  if (value === null || value === undefined || value === '') return 'Not reported';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return reported(value);
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex >= 3 ? 1 : 0)} ${units[unitIndex]}`;
}

function binaryState(value, whenTrue, whenFalse, fallback = 'Not reported') {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return fallback;
}

function formatTemperature(value) {
  const temperature = Number(value);
  if (!Number.isFinite(temperature) || temperature <= 0) return 'Temperature not reported';
  const celsius = temperature > 100 ? temperature / 10 : temperature;
  return `${celsius.toFixed(celsius % 1 ? 1 : 0)}°C`;
}

/**
 * Fully's numeric settings are brightness levels and durations in seconds, so
 * its inputs are bounded. The Android kiosk app's settings are typed by the
 * device, which checks the value itself; they get no ceiling here.
 */
function numberBounds(setting, provider) {
  if (provider === DAYLIGHT_ANDROID) return {};
  return { min: 0, max: setting.key.toLowerCase().includes('brightness') ? 255 : 86400 };
}

function SummaryCard({ label, value, detail }) {
  return (
    <Paper p="sm" withBorder className="fkb-console__summary-card">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="sm" fw={600} lineClamp={2}>{reported(value)}</Text>
      {detail && <Text size="xs" c="dimmed" lineClamp={2}>{detail}</Text>}
    </Paper>
  );
}

function ControlPanel({ title, icon, children }) {
  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Group gap="xs">
          {icon}
          <Text fw={600}>{title}</Text>
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

function ActionButton({ action, label, run, loadingActions, ...props }) {
  return (
    <Button
      size="xs"
      variant="light"
      loading={Boolean(loadingActions[action])}
      onClick={() => run(action)}
      {...props}
    >
      {label}
    </Button>
  );
}

function FullyKioskConsole() {
  const { deviceId } = useParams();
  return <DeviceConsole key={deviceId} deviceId={deviceId} />;
}

function DeviceConsole({ deviceId }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [settings, setSettings] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [settingsFilter, setSettingsFilter] = useState('');
  const [detailFilter, setDetailFilter] = useState('');
  const [draftSettings, setDraftSettings] = useState({});
  const [settingSaving, setSettingSaving] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [screenshotCapturedAt, setScreenshotCapturedAt] = useState('');
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [autoScreenshot, setAutoScreenshot] = useState(false);
  const [loadingActions, setLoadingActions] = useState({});
  const [actionError, setActionError] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [brightness, setBrightness] = useState(128);
  const [targetUrl, setTargetUrl] = useState('');
  const [volume, setVolume] = useState(50);
  const [speech, setSpeech] = useState('');
  const [speechLocale, setSpeechLocale] = useState('');
  const [overlay, setOverlay] = useState('');
  const [packageName, setPackageName] = useState('');
  const screenshotObjectUrlRef = useRef('');

  const readStatus = useCallback(async (isCurrent, signal) => {
    try {
      const result = await fullyKioskAdminApi.status(deviceId, { signal });
      if (!isCurrent()) return;
      setStatus(result);
      setStatusError('');
      const reportedBrightness = Number(result.summary?.brightness);
      if (result.summary?.brightness !== null && result.summary?.brightness !== undefined
        && Number.isFinite(reportedBrightness)) setBrightness(reportedBrightness);
      if (result.summary?.currentUrl) setTargetUrl(current => current || result.summary.currentUrl);
    } catch (error) {
      if (isCurrent()) setStatusError(error.message || 'Unable to reach the device');
    } finally {
      if (isCurrent()) setStatusLoading(false);
    }
  }, [deviceId]);
  const { reload: reloadStatus } = useRefreshableRead(readStatus);
  const refreshStatus = useCallback(({ quiet = false } = {}) => {
    if (!quiet) setStatusLoading(true);
    return reloadStatus();
  }, [reloadStatus]);

  const readSettings = useCallback(async (isCurrent, signal) => {
    setSettingsLoading(true);
    try {
      const result = await fullyKioskAdminApi.settings(deviceId, { signal });
      if (!isCurrent()) return;
      setSettings(result.settings || []);
      setSettingsError('');
      return result;
    } catch (error) {
      if (isCurrent()) setSettingsError(error.message || 'Unable to read settings');
    } finally {
      if (isCurrent()) setSettingsLoading(false);
    }
  }, [deviceId]);
  const { reload: refreshSettings } = useRefreshableRead(readSettings);

  const readScreenshot = useCallback(async (isCurrent, signal) => {
    setScreenshotLoading(true);
    setScreenshotError('');
    try {
      const result = await fullyKioskAdminApi.screenshot(deviceId, { signal });
      if (!isCurrent()) return;
      const nextUrl = URL.createObjectURL(result.blob);
      if (screenshotObjectUrlRef.current) URL.revokeObjectURL(screenshotObjectUrlRef.current);
      screenshotObjectUrlRef.current = nextUrl;
      setScreenshotUrl(nextUrl);
      setScreenshotCapturedAt(result.capturedAt);
    } catch (error) {
      if (isCurrent() && error.name !== 'AbortError') {
        if (screenshotObjectUrlRef.current) URL.revokeObjectURL(screenshotObjectUrlRef.current);
        screenshotObjectUrlRef.current = '';
        setScreenshotUrl('');
        setScreenshotCapturedAt('');
        setScreenshotError(error.message || 'Unable to capture screenshot');
      }
    } finally {
      if (isCurrent()) setScreenshotLoading(false);
    }
  }, [deviceId]);

  const { reload: refreshScreenshot, poll: pollScreenshot } = useRefreshableRead(readScreenshot);

  useEffect(() => {
    refreshStatus();
    refreshSettings();
    refreshScreenshot();
  }, [refreshSettings, refreshScreenshot, refreshStatus]);

  useVisibleRefresh({ active: autoScreenshot, intervalMs: 5000, reload: refreshScreenshot, poll: pollScreenshot });

  useEffect(() => () => {
    if (screenshotObjectUrlRef.current) URL.revokeObjectURL(screenshotObjectUrlRef.current);
  }, []);

  const executeAction = useCallback(async (action, params = {}) => {
    setLoadingActions(current => ({ ...current, [action]: true }));
    setActionError('');
    try {
      await fullyKioskAdminApi.action(deviceId, action, params);
      notifySuccess({ title: 'Command sent', message: humanize(action) });
      await refreshStatus({ quiet: true });
    } catch (error) {
      setActionError(error.message || 'Command failed');
      notifyFailure({ title: 'Command failed', message: error.message });
    } finally {
      setLoadingActions(current => {
        const next = { ...current };
        delete next[action];
        return next;
      });
      setPendingConfirmation(null);
    }
  }, [deviceId, refreshStatus]);

  const wording = useMemo(() => wordingFor(status?.provider), [status?.provider]);

  const runAction = useCallback((action, params = {}) => {
    const confirmation = action === 'restart-app' ? wording.restartApp : CONFIRMATIONS[action];
    if (confirmation) {
      setPendingConfirmation({ action, params, confirmation });
      return;
    }
    executeAction(action, params);
  }, [executeAction, wording]);

  const saveSetting = useCallback(async (setting) => {
    const submittedValue = draftSettings[setting.key];
    setSettingSaving(setting.key);
    try {
      await fullyKioskAdminApi.updateSetting(deviceId, setting.key, submittedValue);
      notifySuccess({ title: 'Setting applied', message: humanize(setting.key) });
      const [freshSettings] = await Promise.all([refreshSettings(), refreshStatus({ quiet: true })]);
      const savedSetting = freshSettings?.settings?.find(current => current.key === setting.key);
      if (savedSetting && Object.is(savedSetting.value, submittedValue)) {
        setDraftSettings(current => {
          if (!Object.prototype.hasOwnProperty.call(current, setting.key)
            || !Object.is(current[setting.key], submittedValue)) return current;
          const next = { ...current };
          delete next[setting.key];
          return next;
        });
      }
    } catch (error) {
      notifyFailure({ title: 'Setting failed', message: error.message });
    } finally {
      setSettingSaving('');
    }
  }, [deviceId, draftSettings, refreshSettings, refreshStatus]);

  const details = useMemo(() => Object.entries(status?.details || {})
    .filter(([key, value]) => `${key} ${reported(value)}`.toLowerCase().includes(detailFilter.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right)), [detailFilter, status]);
  const filteredSettings = useMemo(() => settings.filter(setting => (
    `${setting.key} ${reported(setting.value)}`.toLowerCase().includes(settingsFilter.toLowerCase())
  )), [settings, settingsFilter]);
  const summary = status?.summary || {};
  const device = status?.device || { id: deviceId, name: deviceId };
  // An action the backend leaves out of `capabilities.actions` has no
  // equivalent on this device (the Android kiosk app has no screensaver). A
  // status without the list keeps every control, as before.
  const supports = action => !Array.isArray(status?.capabilities?.actions)
    || status.capabilities.actions.includes(action);
  const hasScreensaver = supports('screensaver-start') || supports('screensaver-stop');
  const connection = statusError
    ? { label: 'Offline', color: 'red' }
    : status
      ? { label: 'Online', color: 'green' }
      : { label: 'Connecting', color: 'yellow' };

  return (
    <Stack gap="md" className="fkb-console">
      <Anchor
        size="sm"
        onClick={() => navigate(`/admin/household/devices/${deviceId}`)}
        className="fkb-console__back"
      >
        <IconArrowBack size={14} /> Back to device
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Box>
          <Group gap="sm">
            <Text className="ds-page-title">{device.name || device.id}</Text>
            <Badge color={connection.color}>{connection.label}</Badge>
          </Group>
          <Text size="sm" c="dimmed">{wording.product} · {device.address || 'Address unavailable'}</Text>
        </Box>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={statusLoading}
          onClick={() => Promise.all([refreshStatus(), refreshSettings()])}
        >
          Refresh device
        </Button>
      </Group>

      {statusError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Device status unavailable">
          {statusError}
        </Alert>
      )}
      {actionError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Command failed" withCloseButton onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      {statusLoading && !status ? (
        <Center h={240}><Loader /></Center>
      ) : (
        <>
          <Grid gutter="md">
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <Paper p="md" withBorder h="100%">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Group gap="xs"><IconPhoto size={18} /><Text fw={600}>Live screenshot</Text></Group>
                    <Group gap="xs">
                      <Switch
                        size="sm"
                        label="Every 5s"
                        checked={autoScreenshot}
                        onChange={event => setAutoScreenshot(event.currentTarget.checked)}
                      />
                      <Button size="xs" variant="light" loading={screenshotLoading} onClick={refreshScreenshot}>
                        Capture
                      </Button>
                    </Group>
                  </Group>
                  <Box className="fkb-console__screenshot-frame">
                    {screenshotUrl ? (
                      <img src={screenshotUrl} alt={`Current screen on ${device.name || device.id}`} />
                    ) : screenshotLoading ? (
                      <Loader />
                    ) : (
                      <Stack align="center" gap="xs">
                        <IconPhoto size={32} />
                        <Text size="sm" c={screenshotError ? 'red' : 'dimmed'}>
                          {screenshotError || 'No screenshot captured'}
                        </Text>
                      </Stack>
                    )}
                  </Box>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      {screenshotCapturedAt ? `Captured ${new Date(screenshotCapturedAt).toLocaleString()}` : 'Not captured'}
                    </Text>
                    {screenshotUrl && (
                      <Group gap="xs">
                        <Button component="a" href={screenshotUrl} target="_blank" size="compact-xs" variant="subtle" leftSection={<IconExternalLink size={13} />}>
                          Full size
                        </Button>
                        <Button component="a" href={screenshotUrl} download={`${deviceId}-screenshot.png`} size="compact-xs" variant="subtle" leftSection={<IconDownload size={13} />}>
                          Download
                        </Button>
                      </Group>
                    )}
                  </Group>
                </Stack>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 5 }}>
              <Paper p="md" withBorder h="100%">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text fw={600}>Quick controls</Text>
                    <Badge variant="dot" color={summary.screenOn ? 'green' : 'gray'}>
                      {binaryState(summary.screenOn, 'Screen on', 'Screen off', 'Screen not reported')}
                    </Badge>
                  </Group>
                  <SimpleGrid cols={{ base: 2, sm: 3, lg: 2 }} spacing="xs">
                    <ActionButton action="screen-on" label="Screen on" run={runAction} loadingActions={loadingActions} />
                    <ActionButton action="screen-off" label="Screen off" run={runAction} loadingActions={loadingActions} />
                    <ActionButton action="foreground" label="Foreground" run={runAction} loadingActions={loadingActions} />
                    <ActionButton action="load-start-url" label="Start URL" run={runAction} loadingActions={loadingActions} />
                    <ActionButton action="refresh" label="Refresh page" run={runAction} loadingActions={loadingActions} />
                    {supports('screensaver-start') && <ActionButton action="screensaver-start" label="Screensaver" run={runAction} loadingActions={loadingActions} />}
                  </SimpleGrid>
                  <Divider />
                  <Text size="xs" c="dimmed">Current page</Text>
                  <Code block className="fkb-console__current-url">{reported(summary.currentUrl)}</Code>
                </Stack>
              </Paper>
            </Grid.Col>
          </Grid>

          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
            <SummaryCard label="Device" value={[summary.manufacturer, summary.model].filter(Boolean).join(' ') || summary.deviceName} detail={`Android ${reported(summary.androidVersion)} · FKB ${reported(summary.appVersion)}`} />
            <SummaryCard label="Display" value={binaryState(summary.screenOn, 'Screen on', 'Screen off')} detail={`${reported(summary.resolution)} · brightness ${reported(summary.brightness)} · orientation ${reported(summary.orientation)}`} />
            <SummaryCard label="Power" value={summary.batteryLevel != null ? `${summary.batteryLevel}%` : null} detail={`${binaryState(summary.plugged, 'Plugged in', 'On battery')} · ${formatTemperature(summary.batteryTemperature)}`} />
            <SummaryCard label="Network" value={summary.ssid} detail={`${reported(summary.ipAddress)} · signal ${reported(summary.wifiSignal)}`} />
            <SummaryCard label="Memory" value={summary.ramFree != null ? `${formatBytes(summary.ramFree)} free` : null} detail={summary.ramTotal != null ? `${formatBytes(summary.ramTotal)} total` : 'Not reported'} />
            <SummaryCard label="Storage" value={summary.storageFree != null ? `${formatBytes(summary.storageFree)} free` : null} detail={summary.storageTotal != null ? `${formatBytes(summary.storageTotal)} total` : 'Not reported'} />
            <SummaryCard label="Kiosk" value={binaryState(summary.kioskLocked, 'Locked', 'Unlocked')} detail={`Mode ${reported(summary.kioskMode)} · maintenance ${reported(summary.maintenanceMode)}`} />
            <SummaryCard label="Foreground" value={summary.foregroundPackage} detail={hasScreensaver ? binaryState(summary.screensaver, 'Screensaver active', 'Screensaver inactive') : undefined} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
            <ControlPanel title="Display & navigation" icon={<IconBulb size={18} />}>
              <Group align="flex-end" wrap="nowrap">
                <NumberInput label="Brightness" min={0} max={255} value={brightness} onChange={setBrightness} flex={1} />
                <Button onClick={() => runAction('set-brightness', { level: brightness })} loading={Boolean(loadingActions['set-brightness'])}>Apply</Button>
              </Group>
              <Group align="flex-end" wrap="nowrap">
                <TextInput label="Load URL" value={targetUrl} onChange={event => setTargetUrl(event.currentTarget.value)} flex={1} />
                <Button onClick={() => runAction('load-url', { url: targetUrl })} loading={Boolean(loadingActions['load-url'])}>Load</Button>
              </Group>
              <Group gap="xs">
                {supports('screensaver-start') && <ActionButton action="screensaver-start" label="Start screensaver" run={runAction} loadingActions={loadingActions} />}
                {supports('screensaver-stop') && <ActionButton action="screensaver-stop" label="Stop screensaver" run={runAction} loadingActions={loadingActions} />}
                <ActionButton action="reset-webview" label="Reset WebView" run={runAction} loadingActions={loadingActions} color="orange" />
                <ActionButton action="restart-app" label="Restart app" run={runAction} loadingActions={loadingActions} color="orange" />
              </Group>
            </ControlPanel>

            <ControlPanel title="Kiosk & applications" icon={<IconDeviceDesktopCog size={18} />}>
              <Group gap="xs">
                <ActionButton action="kiosk-lock" label="Lock kiosk" run={runAction} loadingActions={loadingActions} />
                <ActionButton action="kiosk-unlock" label="Unlock kiosk" run={runAction} loadingActions={loadingActions} color="orange" />
                <ActionButton action="maintenance-enable" label="Maintenance on" run={runAction} loadingActions={loadingActions} color="orange" />
                <ActionButton action="maintenance-disable" label="Maintenance off" run={runAction} loadingActions={loadingActions} />
              </Group>
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  label="Android package"
                  description={status?.companionApps?.length ? `Configured: ${status.companionApps.join(', ')}` : 'Enter a package such as org.example.app'}
                  value={packageName}
                  onChange={event => setPackageName(event.currentTarget.value)}
                  flex={1}
                />
                <Button leftSection={<IconPlayerPlay size={15} />} onClick={() => runAction('launch-app', { package: packageName })} loading={Boolean(loadingActions['launch-app'])}>Launch</Button>
              </Group>
              {status?.companionApps?.length > 0 && (
                <Group gap="xs">
                  {status.companionApps.map(packageValue => (
                    <Button key={packageValue} size="compact-xs" variant="subtle" onClick={() => setPackageName(packageValue)}>
                      {packageValue}
                    </Button>
                  ))}
                </Group>
              )}
            </ControlPanel>

            <ControlPanel title="Audio & messaging" icon={<IconVolume size={18} />}>
              <Group align="flex-end" wrap="nowrap">
                <NumberInput label="Music volume" min={0} max={100} value={volume} onChange={setVolume} flex={1} />
                <Button onClick={() => runAction('set-volume', { level: volume })} loading={Boolean(loadingActions['set-volume'])}>Set</Button>
              </Group>
              <Textarea label="Speak" value={speech} onChange={event => setSpeech(event.currentTarget.value)} maxLength={500} autosize minRows={2} />
              <Group align="flex-end" wrap="nowrap">
                <TextInput label="Locale (optional)" placeholder="en-US" value={speechLocale} onChange={event => setSpeechLocale(event.currentTarget.value)} flex={1} />
                <Button leftSection={<IconVolume size={15} />} onClick={() => runAction('speak', { text: speech, locale: speechLocale })} loading={Boolean(loadingActions.speak)}>Speak</Button>
              </Group>
              <Group align="flex-end" wrap="nowrap">
                <Textarea label="Overlay message" description="Save an empty message to clear it" value={overlay} onChange={event => setOverlay(event.currentTarget.value)} maxLength={500} autosize minRows={2} flex={1} />
                <Button leftSection={<IconMessage size={15} />} onClick={() => runAction('overlay-message', { text: overlay })} loading={Boolean(loadingActions['overlay-message'])}>Apply</Button>
              </Group>
            </ControlPanel>

            <ControlPanel title="Device" icon={<IconReload size={18} />}>
              <Text size="sm" c="dimmed">{wording.reboot}</Text>
              <Group>
                <ActionButton action="reboot" label="Reboot device" run={runAction} loadingActions={loadingActions} color="red" />
              </Group>
            </ControlPanel>
          </SimpleGrid>

          <Accordion variant="separated" multiple defaultValue={[]}>
            <Accordion.Item value="details">
              <Accordion.Control icon={<IconDeviceDesktopCog size={18} />}>Full device information ({details.length})</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <TextInput placeholder="Search device information" value={detailFilter} onChange={event => setDetailFilter(event.currentTarget.value)} />
                  <ScrollArea h={420}>
                    <Table striped highlightOnHover withTableBorder>
                      <Table.Thead><Table.Tr><Table.Th>Field</Table.Th><Table.Th>Value</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>
                        {details.map(([key, value]) => (
                          <Table.Tr key={key}><Table.Td><Code>{key}</Code></Table.Td><Table.Td className="fkb-console__value">{reported(value)}</Table.Td></Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="settings">
              <Accordion.Control icon={<IconSettings size={18} />}>{wording.product} settings ({filteredSettings.length})</Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  {settingsError && <Alert color="red">{settingsError}</Alert>}
                  <TextInput placeholder="Search settings" value={settingsFilter} onChange={event => setSettingsFilter(event.currentTarget.value)} />
                  {settingsLoading ? <Center h={120}><Loader /></Center> : (
                    <ScrollArea h={560}>
                      <Table striped highlightOnHover withTableBorder>
                        <Table.Thead><Table.Tr><Table.Th>Setting</Table.Th><Table.Th>Value</Table.Th><Table.Th>Access</Table.Th><Table.Th /></Table.Tr></Table.Thead>
                        <Table.Tbody>
                          {filteredSettings.map(setting => {
                            const hasDraft = Object.prototype.hasOwnProperty.call(draftSettings, setting.key);
                            const draft = hasDraft ? draftSettings[setting.key] : setting.value;
                            const dirty = hasDraft && !Object.is(draft, setting.value);
                            return (
                              <Table.Tr key={setting.key}>
                                <Table.Td><Code>{setting.key}</Code></Table.Td>
                                <Table.Td className="fkb-console__setting-value">
                                  {setting.sensitive ? <Text c="dimmed">••••••</Text> : setting.editable && setting.type === 'boolean' ? (
                                    <Switch aria-label={setting.key} checked={Boolean(draft)} onChange={event => setDraftSettings(current => ({ ...current, [setting.key]: event.currentTarget.checked }))} />
                                  ) : setting.editable && setting.type === 'number' ? (
                                    <NumberInput aria-label={setting.key} value={draft ?? ''} {...numberBounds(setting, status?.provider)} onChange={value => setDraftSettings(current => ({ ...current, [setting.key]: value }))} />
                                  ) : setting.editable ? (
                                    <TextInput aria-label={setting.key} value={draft ?? ''} onChange={event => setDraftSettings(current => ({ ...current, [setting.key]: event.currentTarget.value }))} />
                                  ) : (
                                    <Text size="sm">{reported(setting.value)}</Text>
                                  )}
                                </Table.Td>
                                <Table.Td><Badge color={setting.sensitive ? 'red' : setting.editable ? 'blue' : 'gray'}>{setting.sensitive ? 'Masked' : setting.editable ? 'Editable' : 'Read only'}</Badge></Table.Td>
                                <Table.Td>
                                  {setting.editable && (
                                    <Button size="compact-xs" disabled={!dirty} loading={settingSaving === setting.key} onClick={() => saveSetting(setting)}>Save</Button>
                                  )}
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}

      <ConfirmModal
        opened={Boolean(pendingConfirmation)}
        onClose={() => setPendingConfirmation(null)}
        onConfirm={() => pendingConfirmation && executeAction(pendingConfirmation.action, pendingConfirmation.params)}
        title={pendingConfirmation?.confirmation[0]}
        message={pendingConfirmation?.confirmation[1]}
        confirmLabel={pendingConfirmation?.confirmation[2]}
        loading={Boolean(pendingConfirmation && loadingActions[pendingConfirmation.action])}
      />
    </Stack>
  );
}

export default FullyKioskConsole;
