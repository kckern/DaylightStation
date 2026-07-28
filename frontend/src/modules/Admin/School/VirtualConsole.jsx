import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Card, Chip, Code, Group, Loader, NumberInput,
  ScrollArea, SegmentedControl, Stack, Text, TextInput, Title,
} from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import './VirtualConsole.scss';

/**
 * VirtualConsole — the human-drivable face of the School virtual hardware.
 *
 * The physical console (laser printer, thermal printer, barcode scanner,
 * TV/headset playback, OMR bubble-sheet reader) is not assembled and can never
 * be in CI. Phase E built a double for each device; this page drives them:
 * scan a code, watch the worksheet PDF appear, play media to completion, fill
 * in bubble answers, knock a printer offline, and see the loop respond.
 *
 * The backing routes exist ONLY when the doubles are wired
 * (`school.yml` → `virtualDevices: true`). When they are not, every call 404s
 * and this page says so rather than looking broken.
 *
 * @module Admin/School/VirtualConsole
 */

const API = '/api/v1/school/devices';
const POLL_MS = 3000;
/** Tokens the console can replay straight off the last receipt. */
const TOKEN_RE = /\bsch:[A-Za-z0-9._:-]+/g;
const PRINTER_FAULTS = [
  { label: 'OK', value: 'none' },
  { label: 'Offline', value: 'offline' },
  { label: 'Jam', value: 'jam' },
];

/** @returns {Promise<any>} parsed body; throws with the router's `error` string. */
async function callApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!res.ok) {
    const err = new Error(parsed?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = parsed?.code;
    throw err;
  }
  return parsed;
}

/** Distinct `sch:` tokens in a receipt transcript, newest receipt first. */
function tokensFrom(captures) {
  const receipt = captures.find((c) => c.kind === 'thermal' && c.transcript);
  if (!receipt) return [];
  return [...new Set(receipt.transcript.match(TOKEN_RE) || [])];
}

/** Group a layout row's bubbles by the item that owns them. */
function itemsInRow(row) {
  const byItem = new Map();
  for (const choice of row.choices) {
    if (!byItem.has(choice.itemId)) byItem.set(choice.itemId, []);
    byItem.get(choice.itemId).push(choice);
  }
  return [...byItem.entries()].map(([itemId, choices]) => ({ itemId, choices }));
}

const toBinary = (mask) => mask.toString(2).padStart(12, '0');

export default function VirtualConsole() {
  const logger = useMemo(() => getLogger().child({ component: 'virtual-console' }), []);

  const [state, setState] = useState({ devices: null, captures: [], dispatches: [] });
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const [scanCode, setScanCode] = useState('');
  const [selectedCapture, setSelectedCapture] = useState(null);
  const [advanceSeconds, setAdvanceSeconds] = useState(30);

  const [formId, setFormId] = useState('');
  const [layout, setLayout] = useState(null);
  const [answers, setAnswers] = useState({});
  const [ambiguous, setAmbiguous] = useState([]);
  const [blank, setBlank] = useState([]);
  const [lastSheet, setLastSheet] = useState(null);

  // Race guard: polls and post-action refreshes overlap, and a slow reply must
  // never overwrite a newer one.
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const [status, captures, playback] = await Promise.all([
        callApi('/status'),
        callApi('/captures').catch(() => ({ captures: [] })),
        callApi('/playback').catch(() => ({ dispatches: [] })),
      ]);
      if (seq !== seqRef.current) {
        logger.debug('refresh-superseded', { seq, latest: seqRef.current });
        return;
      }
      setState({
        devices: status.devices,
        captures: captures.captures || [],
        dispatches: playback.dispatches || [],
      });
      setEnabled(true);
      // Clear only our own failure. An action's error must survive the next
      // poll — otherwise "that fault was rejected" vanishes in three seconds.
      setError((prev) => (prev?.source === 'refresh' ? null : prev));
    } catch (err) {
      if (seq !== seqRef.current) return;
      if (err.status === 404) {
        setEnabled(false);
        logger.warn('console-not-wired', { status: err.status });
      } else {
        setError({ source: 'refresh', message: err.message });
        logger.error('refresh-failed', { error: err.message, status: err.status });
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [logger]);

  useEffect(() => {
    logger.info('mounted', {});
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
      logger.info('unmounted', {});
    };
  }, [logger, refresh]);

  /** Run one console action: log it, surface failures, refresh after. */
  const act = useCallback(async (action, path, options) => {
    setBusy(action);
    setError(null);
    logger.info('action-dispatch', { action, path, method: options?.method || 'GET' });
    try {
      const result = await callApi(path, options);
      logger.debug('action-ok', { action });
      await refresh();
      return result;
    } catch (err) {
      setError({ source: 'action', message: `${action}: ${err.message}` });
      logger.error('action-failed', { action, error: err.message, status: err.status, code: err.code });
      return null;
    } finally {
      setBusy(null);
    }
  }, [logger, refresh]);

  const doScan = useCallback((code) => {
    const trimmed = (code || '').trim();
    if (!trimmed) return;
    act('scan', '/scan', { method: 'POST', body: { code: trimmed, device: 'virtual-console' } });
    setScanCode('');
  }, [act]);

  const loadLayout = useCallback(async () => {
    const id = formId.trim();
    if (!id) return;
    setLayout(null);
    setAnswers({});
    setAmbiguous([]);
    setBlank([]);
    setLastSheet(null);
    const result = await act('omr-layout', `/omr/forms/${encodeURIComponent(id)}/layout`);
    if (result) setLayout(result);
  }, [act, formId]);

  const submitOmr = useCallback(async () => {
    const result = await act('omr-submit', '/omr/submit', {
      method: 'POST',
      body: { formId: formId.trim(), answers, ambiguous, blank },
    });
    if (result) setLastSheet(result.sheet);
  }, [act, formId, answers, ambiguous, blank]);

  const toggleIn = (list, setList, itemId) => setList(
    list.includes(itemId) ? list.filter((x) => x !== itemId) : [...list, itemId],
  );

  if (loading) return <Loader p="md" />;

  if (!enabled) {
    return (
      <Alert color="yellow" title="Virtual device console is off" m="md">
        The virtual doubles are not wired. Set <Code>virtualDevices: true</Code> in{' '}
        <Code>school.yml</Code> and restart the backend; the routes do not exist until then.
      </Alert>
    );
  }

  const devices = state.devices || {};
  const tokens = tokensFrom(state.captures);
  const capturePreviewUrl = selectedCapture
    ? `${API}/captures/${selectedCapture.kind}/${encodeURIComponent(selectedCapture.id)}`
    : null;

  return (
    <Stack gap="md" p="md" className="school-virtual-console">
      <Group justify="space-between">
        <Title order={3}>School Virtual Device Console</Title>
        <Button variant="subtle" size="xs" onClick={refresh}>Refresh</Button>
      </Group>

      {error && (
        <Alert
          color="red"
          title={error.source === 'action' ? 'Action failed' : "Couldn't reach the console"}
          onClose={() => setError(null)}
          withCloseButton
        >
          {error.message}
        </Alert>
      )}

      {/* ---------------------------------------------------------------- */}
      <Card withBorder padding="md">
        <Title order={5} mb="xs">Printers</Title>
        <Group align="flex-start" gap="xl">
          {['laser', 'thermal'].map((device) => (
            <Stack key={device} gap={4}>
              <Group gap="xs">
                <Text fw={600} tt="capitalize">{device}</Text>
                {devices[device]?.present
                  ? <Badge color={devices[device].fault ? 'red' : 'green'}>{devices[device].fault || 'ok'}</Badge>
                  : <Badge color="gray">not wired</Badge>}
              </Group>
              <SegmentedControl
                size="xs"
                data={PRINTER_FAULTS}
                disabled={!devices[device]?.present || busy === `fault-${device}`}
                value={devices[device]?.fault || 'none'}
                onChange={(value) => act(`fault-${device}`, '/fault', {
                  method: 'POST',
                  body: { device, fault: value === 'none' ? null : value },
                })}
              />
            </Stack>
          ))}
        </Group>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card withBorder padding="md">
        <Title order={5} mb="xs">Scanner</Title>
        <Group align="flex-end" gap="sm">
          <TextInput
            label="Code"
            placeholder="sch:… or any barcode"
            value={scanCode}
            className="school-virtual-console__scan-input"
            onChange={(e) => setScanCode(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doScan(scanCode); }}
          />
          <Button
            disabled={!devices.scanner?.present || !scanCode.trim()}
            loading={busy === 'scan'}
            onClick={() => doScan(scanCode)}
          >
            Scan
          </Button>
        </Group>
        {tokens.length > 0 && (
          <Group gap="xs" mt="sm">
            <Text size="sm" c="dimmed">From the last receipt:</Text>
            {tokens.map((token) => (
              <Button key={token} size="xs" variant="light" onClick={() => doScan(token)}>{token}</Button>
            ))}
          </Group>
        )}
        {devices.scanner?.lastScan && (
          <Text size="sm" c="dimmed" mt="xs">
            Last scan: <Code>{devices.scanner.lastScan.code}</Code> from {devices.scanner.lastScan.device}
            {' '}({devices.scanner.scans} total)
          </Text>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card withBorder padding="md">
        <Title order={5} mb="xs">Playback</Title>
        {state.dispatches.length === 0 && <Text c="dimmed" size="sm">No dispatches yet.</Text>}
        <Stack gap="xs">
          {state.dispatches.map((d) => (
            <Group key={d.dispatchId} gap="sm" wrap="wrap">
              <Badge color={d.status === 'completed' ? 'green' : d.status === 'stopped' ? 'orange' : 'blue'}>
                {d.status}
              </Badge>
              <Text size="sm"><Code>{d.dispatchId}</Code> {d.target} · {d.contentId}</Text>
              <Text size="sm" c="dimmed">{d.positionSec}/{d.durationSec}s{d.learnerId ? ` · ${d.learnerId}` : ''}</Text>
              <Button
                size="xs" variant="light" disabled={d.status !== 'playing'}
                loading={busy === `complete-${d.dispatchId}`}
                onClick={() => act(`complete-${d.dispatchId}`, `/playback/${d.dispatchId}/complete`, { method: 'POST' })}
              >
                Complete
              </Button>
              <Button
                size="xs" variant="light" color="orange" disabled={d.status !== 'playing'}
                loading={busy === `interrupt-${d.dispatchId}`}
                onClick={() => act(`interrupt-${d.dispatchId}`, `/playback/${d.dispatchId}/interrupt`, { method: 'POST' })}
              >
                Interrupt
              </Button>
              <Button
                size="xs" variant="subtle" disabled={d.status !== 'playing'}
                loading={busy === `advance-${d.dispatchId}`}
                onClick={() => act(`advance-${d.dispatchId}`, `/playback/${d.dispatchId}/advance`, {
                  method: 'POST', body: { seconds: advanceSeconds },
                })}
              >
                Advance
              </Button>
            </Group>
          ))}
        </Stack>
        <NumberInput
          mt="sm" size="xs" label="Advance by (seconds)" min={1} w={180}
          value={advanceSeconds}
          onChange={(value) => setAdvanceSeconds(Number(value) || 1)}
        />
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card withBorder padding="md">
        <Title order={5} mb="xs">Captures</Title>
        {state.captures.length === 0 && <Text c="dimmed" size="sm">Nothing printed yet.</Text>}
        <Group align="flex-start" gap="md" wrap="nowrap" className="school-virtual-console__captures">
          <ScrollArea h={320} className="school-virtual-console__capture-list">
            <Stack gap={4}>
              {state.captures.map((capture) => (
                <Button
                  key={`${capture.kind}:${capture.id}`}
                  variant={selectedCapture?.id === capture.id ? 'filled' : 'subtle'}
                  size="xs"
                  justify="flex-start"
                  onClick={() => {
                    setSelectedCapture(capture);
                    logger.debug('capture-selected', { kind: capture.kind, id: capture.id });
                  }}
                >
                  <Badge size="xs" mr="xs" color={capture.kind === 'laser' ? 'grape' : 'teal'}>{capture.kind}</Badge>
                  {capture.title || capture.id}
                </Button>
              ))}
            </Stack>
          </ScrollArea>
          <div className="school-virtual-console__capture-preview">
            {!selectedCapture && <Text c="dimmed" size="sm">Pick a capture to view it.</Text>}
            {selectedCapture?.kind === 'laser' && (
              <iframe title={`worksheet ${selectedCapture.id}`} src={capturePreviewUrl} />
            )}
            {selectedCapture?.kind === 'thermal' && (
              <pre className="school-virtual-console__transcript">{selectedCapture.transcript}</pre>
            )}
          </div>
        </Group>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card withBorder padding="md">
        <Title order={5} mb="xs">OMR bubble sheet</Title>
        <Group align="flex-end" gap="sm">
          <TextInput
            label="Form id" placeholder="wk-fractions-v1" value={formId}
            onChange={(e) => setFormId(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadLayout(); }}
          />
          <Button
            variant="light" disabled={!devices.omr?.forms || !formId.trim()}
            loading={busy === 'omr-layout'} onClick={loadLayout}
          >
            Load form
          </Button>
        </Group>

        {layout && (
          <Stack gap="xs" mt="md">
            <Text size="sm" c="dimmed">
              {layout.formVersion} · {layout.layout.length} reader columns
            </Text>
            {layout.layout.flatMap((row) => itemsInRow(row).map(({ itemId, choices }) => (
              <Group key={`${row.columnIndex}:${itemId}`} gap="sm" wrap="wrap">
                <Text size="sm" w={90} fw={600}>{itemId}</Text>
                <Text size="xs" c="dimmed" w={40}>col {row.columnIndex}</Text>
                <Chip.Group
                  multiple={false}
                  value={answers[itemId] ?? ''}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [itemId]: value }))}
                >
                  <Group gap={4}>
                    {choices.map((choice) => (
                      <Chip key={choice.choice} size="xs" value={choice.choice} disabled={blank.includes(itemId)}>
                        {choice.choice}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
                <Button
                  size="xs" variant={ambiguous.includes(itemId) ? 'filled' : 'subtle'} color="orange"
                  disabled={blank.includes(itemId) || choices.length < 2}
                  onClick={() => toggleIn(ambiguous, setAmbiguous, itemId)}
                >
                  Ambiguous
                </Button>
                <Button
                  size="xs" variant={blank.includes(itemId) ? 'filled' : 'subtle'} color="gray"
                  onClick={() => {
                    toggleIn(blank, setBlank, itemId);
                    setAnswers((prev) => { const next = { ...prev }; delete next[itemId]; return next; });
                    setAmbiguous((prev) => prev.filter((x) => x !== itemId));
                  }}
                >
                  Blank
                </Button>
              </Group>
            )))}
            <Group mt="xs">
              <Button loading={busy === 'omr-submit'} onClick={submitOmr}>Feed sheet</Button>
            </Group>
          </Stack>
        )}

        {lastSheet && (
          <Stack gap={2} mt="md">
            <Text size="sm">
              Sheet from <Code>{lastSheet.id}</Code>: {lastSheet.markedColumns}/{lastSheet.columns} columns marked
            </Text>
            <Code block>{lastSheet.marks.map((m, i) => `col ${i}: ${toBinary(m)}`).join('\n')}</Code>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
