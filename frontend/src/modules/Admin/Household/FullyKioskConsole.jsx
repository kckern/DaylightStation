import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ConfirmModal from '../shared/ConfirmModal.jsx';
import { notifyFailure, notifySuccess } from '../shared/feedback.js';
import fullyKioskAdminApi from './fullyKioskAdminApi.js';
import './FullyKioskConsole.scss';

const CONFIRMATIONS = Object.freeze({
  'reset-webview': ['Reset WebView?', 'The current page renderer will be recreated.', 'Reset WebView'],
  'restart-app': ['Restart Fully Kiosk?', 'Fully Kiosk will briefly leave and restart the current page.', 'Restart app'],
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
  const screenshotAbortRef = useRef(null);
  const screenshotObjectUrlRef = useRef('');
  const screenshotInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const refreshStatus = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setStatusLoading(true);
    try {
      const result = await fullyKioskAdminApi.status(deviceId);
      setStatus(result);
      setStatusError('');
      const reportedBrightness = Number(result.summary?.brightness);
      if (result.summary?.brightness !== null && result.summary?.brightness !== undefined
        && Number.isFinite(reportedBrightness)) setBrightness(reportedBrightness);
      if (result.summary?.currentUrl) setTargetUrl(current => current || result.summary.currentUrl);
    } catch (error) {
      setStatusError(error.message || 'Unable to reach the device');
    } finally {
      if (!quiet) setStatusLoading(false);
    }
  }, [deviceId]);

  const refreshSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const result = await fullyKioskAdminApi.settings(deviceId);
      setSettings(result.settings || []);
      setDraftSettings(Object.fromEntries((result.settings || []).map(setting => [setting.key, setting.value])));
      setSettingsError('');
    } catch (error) {
      setSettingsError(error.message || 'Unable to read settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [deviceId]);

  const refreshScreenshot = useCallback(async () => {
    if (screenshotInFlightRef.current) return;
    screenshotInFlightRef.current = true;
    setScreenshotLoading(true);
    setScreenshotError('');
    const controller = new AbortController();
    screenshotAbortRef.current = controller;
    try {
      const result = await fullyKioskAdminApi.screenshot(deviceId, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      const nextUrl = URL.createObjectURL(result.blob);
      if (screenshotObjectUrlRef.current) URL.revokeObjectURL(screenshotObjectUrlRef.current);
      screenshotObjectUrlRef.current = nextUrl;
      setScreenshotUrl(nextUrl);
      setScreenshotCapturedAt(result.capturedAt);
    } catch (error) {
      if (mountedRef.current && error.name !== 'AbortError') {
        if (screenshotObjectUrlRef.current) URL.revokeObjectURL(screenshotObjectUrlRef.current);
        screenshotObjectUrlRef.current = '';
        setScreenshotUrl('');
        setScreenshotCapturedAt('');
        setScreenshotError(error.message || 'Unable to capture screenshot');
      }
    } finally {
      screenshotInFlightRef.current = false;
      if (mountedRef.current) setScreenshotLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    refreshStatus();
    refreshSettings();
    refreshScreenshot();
  }, [refreshSettings, refreshScreenshot, refreshStatus]);

  useEffect(() => {
    if (!autoScreenshot) return undefined;
    const timer = window.setInterval(refreshScreenshot, 5000);
    return () => window.clearInterval(timer);
  }, [autoScreenshot, refreshScreenshot]);

  useEffect(() => () => {
    mountedRef.current = false;
    screenshotAbortRef.current?.abort();
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

  const runAction = useCallback((action, params = {}) => {
    const confirmation = CONFIRMATIONS[action];
    if (confirmation) {
      setPendingConfirmation({ action, params, confirmation });
      return;
    }
    executeAction(action, params);
  }, [executeAction]);

  const saveSetting = useCallback(async (setting) => {
    setSettingSaving(setting.key);
    try {
      await fullyKioskAdminApi.updateSetting(deviceId, setting.key, draftSettings[setting.key]);
      notifySuccess({ title: 'Setting applied', message: humanize(setting.key) });
      await Promise.all([refreshSettings(), refreshStatus({ quiet: true })]);
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
          <Text size="sm" c="dimmed">Fully Kiosk · {device.address || 'Address unavailable'}</Text>
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
                    <ActionButton action="screensaver-start" label="Screensaver" run={runAction} loadingActions={loadingActions} />
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
            <SummaryCard label="Foreground" value={summary.foregroundPackage} detail={binaryState(summary.screensaver, 'Screensaver active', 'Screensaver inactive')} />
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
                <ActionButton action="screensaver-start" label="Start screensaver" run={runAction} loadingActions={loadingActions} />
                <ActionButton action="screensaver-stop" label="Stop screensaver" run={runAction} loadingActions={loadingActions} />
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
              <Text size="sm" c="dimmed">Reboot is sent through Fully Kiosk. The device may drop the request while it restarts.</Text>
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
              <Accordion.Control icon={<IconSettings size={18} />}>Fully Kiosk settings ({filteredSettings.length})</Accordion.Control>
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
                            const draft = draftSettings[setting.key];
                            const dirty = draft !== setting.value;
                            return (
                              <Table.Tr key={setting.key}>
                                <Table.Td><Code>{setting.key}</Code></Table.Td>
                                <Table.Td className="fkb-console__setting-value">
                                  {setting.sensitive ? <Text c="dimmed">••••••</Text> : setting.editable && setting.type === 'boolean' ? (
                                    <Switch checked={Boolean(draft)} onChange={event => setDraftSettings(current => ({ ...current, [setting.key]: event.currentTarget.checked }))} />
                                  ) : setting.editable && setting.type === 'number' ? (
                                    <NumberInput value={draft ?? ''} min={0} max={setting.key.toLowerCase().includes('brightness') ? 255 : 86400} onChange={value => setDraftSettings(current => ({ ...current, [setting.key]: value }))} />
                                  ) : setting.editable ? (
                                    <TextInput value={draft ?? ''} onChange={event => setDraftSettings(current => ({ ...current, [setting.key]: event.currentTarget.value }))} />
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
