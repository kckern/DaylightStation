import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Button, FileInput, Group, List, Modal, SegmentedControl, Select,
  Skeleton, Stack, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconPhoto, IconPlayerStop, IconRefresh, IconUpload } from '@tabler/icons-react';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { useSheetSubmission } from "../../../../../frontend/src/lib/ui/useSheetSubmission.js";
import { useSheetMusicLibrary, uploadScore } from "./useSheetMusicLibrary.js";
import { scoreViewPath } from "../PianoKiosk/modes/SheetMusic/sheetMusicModel.js";
import { DaylightAPIText } from "../../../../../frontend/src/lib/api.mjs";
import { osmdEngrave } from "../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js";
import { POSTER_ENGRAVE_WIDTH, POSTER_ERROR_MESSAGES, generateMissingPosters } from "./posterJob.js";

/** Readable copy for every code POST /upload can answer with. */
export const UPLOAD_ERROR_MESSAGES = {
  'invalid-request': 'The upload was not understood. Choose a file and a folder, then try again.',
  'bad-extension': 'Only .musicxml and .mxl files can be uploaded.',
  SCORE_TOO_LARGE: 'That file is too large to upload.',
  'bad-mxl': 'That .mxl file is not a readable compressed MusicXML archive.',
  'not-xml': 'That file is not readable XML.',
  timewise: 'That score is timewise MusicXML. Export it as partwise and upload again.',
  'not-partwise': 'That file is not a partwise MusicXML score.',
  'no-notes': 'That score has no notes in it.',
  'slug-too-long': 'That file name is too long. Choose a shorter one.',
  'bad-folder': 'Choose one of the listed folders.',
  'bad-filename': 'File names may use lowercase letters, numbers and hyphens, starting with a letter or number, and must keep the uploaded file\'s extension.',
  'basename-exists': 'That folder already has a score with that file name. Choose a different file name.',
  'slug-collides': 'Another score in the library would share this one\'s practice key. Choose a different file name.',
  network: 'The server could not be reached. Check the connection and try again.',
};
const GENERIC_UPLOAD_ERROR = 'The upload failed. Try again, or check the server logs.';

const FILTERS = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'no-poster', label: 'No poster', test: (s) => s.poster === 'none' },
  { value: 'no-segments', label: 'No segments', test: (s) => s.learn === 'none' },
  { value: 'draft', label: 'Draft pending', test: (s) => s.learn === 'draft' || s.learn === 'approved+draft' },
  { value: 'stale', label: 'Stale', test: (s) => s.learn === 'stale' },
];

const FORMAT_LABEL = { musicxml: 'MusicXML', mxl: 'MXL' };
const POSTER_COLOR = { scan: 'teal', generated: 'blue', none: 'gray' };
const LEARN_BADGE = {
  none: { label: 'none', color: 'gray' },
  draft: { label: 'draft', color: 'yellow' },
  approved: { label: 'approved', color: 'green' },
  'approved+draft': { label: 'approved + draft', color: 'lime' },
  stale: { label: 'stale', color: 'orange' },
};

/** The relative score route; the same encoder the kiosk uses. */
export const scorePath = scoreViewPath;

function LearnBadge({ learn }) {
  const spec = learn == null ? { label: 'unreadable', color: 'red' } : (LEARN_BADGE[learn] || { label: String(learn), color: 'gray' });
  return <Badge variant="light" color={spec.color}>{spec.label}</Badge>;
}

function Learners({ learners }) {
  const list = Array.isArray(learners) ? learners : [];
  if (list.length === 0) return <Text size="sm" c="dimmed">none</Text>;
  const label = (
    <Stack gap={0}>
      {list.map((l) => <Text key={l.userId} size="xs">{l.userId}: {l.passagesWithProgress} passages</Text>)}
    </Stack>
  );
  return (
    <Tooltip label={label} withArrow events={{ hover: true, focus: true, touch: true }}>
      <Text size="sm" tabIndex={0} style={{ cursor: 'help' }}>{list.length} {list.length === 1 ? 'learner' : 'learners'}</Text>
    </Tooltip>
  );
}

function ScoreRow({ score, onOpen }) {
  return (
    <Table.Tr onClick={() => onOpen(score)} style={{ cursor: 'pointer' }}>
      <Table.Td>
        <Anchor
          component={Link}
          to={scorePath(score.id)}
          size="sm"
          fw={500}
          onClick={(e) => e.stopPropagation()}
        >
          {score.title || score.file}
        </Anchor>
        <Text size="xs" c="dimmed">{score.file}</Text>
      </Table.Td>
      <Table.Td><Text size="sm">{score.composer || ''}</Text></Table.Td>
      <Table.Td><Badge variant="outline" color="gray">{FORMAT_LABEL[score.format] || score.format}</Badge></Table.Td>
      <Table.Td><Badge variant="light" color={POSTER_COLOR[score.poster] || 'gray'}>{score.poster}</Badge></Table.Td>
      <Table.Td><LearnBadge learn={score.learn} /></Table.Td>
      <Table.Td><Learners learners={score.learners} /></Table.Td>
      <Table.Td>{score.error ? <Badge color="red" variant="filled">{score.error}</Badge> : null}</Table.Td>
    </Table.Tr>
  );
}

/** `files:docs/x.mxl` → its stream URL path, as the score page fetches it. */
const fetchScoreXml = (id) => DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(id.replace(/^[a-z]+:/i, ''))}`);

/** Progress, cancel and the failure list of a "Generate missing posters" run. */
function PosterRun({ run, titles, onCancel, onDismiss }) {
  if (!run) return null;
  const { running, index, total, saved, failed, cancelled } = run;
  const status = running
    ? `Generating posters: ${Math.min(index + 1, total)} of ${total}`
    : cancelled
      ? `Stopped after ${saved} of ${total}. ${failed.length ? `${failed.length} failed.` : ''}`
      : `Generated ${saved} of ${total} posters.${failed.length ? ` ${failed.length} failed.` : ''}`;
  return (
    <Alert
      color={running ? 'blue' : failed.length ? 'yellow' : 'teal'}
      variant="light"
      icon={<IconPhoto size={16} />}
      withCloseButton={!running}
      onClose={onDismiss}
      data-testid="poster-run"
    >
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" data-testid="poster-run-status">{status.trim()}</Text>
          {running ? (
            <Button size="xs" variant="default" leftSection={<IconPlayerStop size={14} />} onClick={onCancel} disabled={run.cancelling}>
              {run.cancelling ? 'Stopping…' : 'Stop'}
            </Button>
          ) : null}
        </Group>
        {failed.length ? (
          <List size="sm" spacing={0} data-testid="poster-run-failures">
            {failed.map((f) => (
              <List.Item key={f.id}>{`${titles[f.id] || f.id}: ${POSTER_ERROR_MESSAGES[f.code] || f.code}`}</List.Item>
            ))}
          </List>
        ) : null}
      </Stack>
    </Alert>
  );
}

function LoadingSkeleton() {
  return (
    <Stack gap="xs" data-testid="sheet-music-loading">
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={36} radius="sm" />)}
    </Stack>
  );
}

/** Lowercases what the user types; the extension is added on submit when missing. */
const withExtension = (name, file) => {
  const trimmed = name.trim();
  if (!trimmed) return '';
  if (/\.(musicxml|mxl)$/.test(trimmed)) return trimmed;
  const ext = /\.(musicxml|mxl)$/i.exec(file?.name || '')?.[1]?.toLowerCase();
  return ext ? `${trimmed}.${ext}` : trimmed;
};

function UploadModal({ opened, onClose, folders, logger, onUploaded }) {
  const [file, setFile] = useState(null);
  const [folder, setFolder] = useState(null);
  const [filename, setFilename] = useState('');
  const [message, setMessage] = useState(null);
  const { run, saving: busy, failure, clearFailure } = useSheetSubmission(onClose, (error) => {
    logger.warn('admin.sheetmusic.upload-failed', { code: error?.code || 'unknown', status: error?.status ?? null });
  });

  useEffect(() => {
    if (!opened) {
      setFile(null); setFolder(null); setFilename(''); setMessage(null);
      if (failure) clearFailure();
    }
  }, [opened, failure, clearFailure]);

  const submit = (event) => {
    event?.preventDefault?.();
    if (!file || !folder || busy) return;
    const name = withExtension(filename, file);
    setMessage(null);
    logger.info('admin.sheetmusic.upload-start', { folder, bytes: file.size ?? null, named: Boolean(name) });
    run(() => uploadScore({ file, folder, filename: name }), {
      valid: Boolean(file && folder),
      onSuccess: (outcome) => {
        if (outcome.ok) {
          logger.info('admin.sheetmusic.upload-done', { id: outcome.result.id });
          onUploaded(outcome.result);
          return;
        }
        logger.warn('admin.sheetmusic.upload-failed', { code: outcome.code, status: outcome.status });
        setMessage(UPLOAD_ERROR_MESSAGES[outcome.code] || GENERIC_UPLOAD_ERROR);
      },
    });
  };
  const visibleMessage = message || (failure ? UPLOAD_ERROR_MESSAGES[failure.code] || GENERIC_UPLOAD_ERROR : null);

  return (
    <Modal
      opened={opened}
      onClose={() => { if (!busy) onClose(); }}
      title="Upload a score"
      centered
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
    >
      <form onSubmit={submit}>
        <Stack gap="sm">
          <FileInput
            label="Score file"
            placeholder="Choose a .musicxml or .mxl file"
            accept=".musicxml,.mxl"
            value={file}
            onChange={setFile}
            disabled={busy}
            clearButtonProps={{ 'aria-label': 'Clear selected file', disabled: busy }}
            required
            clearable
          />
          {folders.length > 0 ? (
            <Select
              label="Folder"
              placeholder="Choose a folder"
              data={folders}
              value={folder}
              onChange={setFolder}
              disabled={busy}
              required
              comboboxProps={{ withinPortal: false }}
            />
          ) : (
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />} variant="light">
              No upload folders are available. Close this, reload the library and try again.
            </Alert>
          )}
          <TextInput
            label="File name"
            description="Optional. Lowercase letters, numbers and hyphens. The extension is added for you."
            placeholder="suggested from the score title"
            value={filename}
            onChange={(e) => setFilename(e.currentTarget.value.toLowerCase())}
            disabled={busy}
          />
          {visibleMessage ? (
            <Alert color="red" icon={<IconAlertTriangle size={16} />} variant="light">{visibleMessage}</Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={busy || !file || !folder}>Upload</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default function SheetMusicLibrary() {
  const logger = useMemo(() => getLogger().child({ component: 'admin-sheet-music' }), []);
  const navigate = useNavigate();
  const { scores, folders, loading, error, reload } = useSheetMusicLibrary(logger);
  const [filter, setFilter] = useState('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [posterRun, setPosterRun] = useState(null);
  const posterHostRef = useRef(null);
  const cancelPostersRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cancelPostersRef.current = true; };
  }, []);

  useEffect(() => { logger.info('admin.sheetmusic.mounted'); }, [logger]);

  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map((f) => [f.value, scores.filter(f.test).length]),
  ), [scores]);

  const groups = useMemo(() => {
    const test = (FILTERS.find((f) => f.value === filter) || FILTERS[0]).test;
    const visible = scores.filter(test);
    const order = [...folders];
    visible.forEach((s) => { if (!order.includes(s.folder)) order.push(s.folder); });
    return order
      .map((name) => ({ name, rows: visible.filter((s) => s.folder === name) }))
      .filter((g) => g.rows.length > 0);
  }, [scores, folders, filter]);

  const missingPosters = useMemo(
    () => groups.flatMap((g) => g.rows).filter((s) => s.poster === 'none' && !s.error),
    [groups],
  );
  const titles = useMemo(() => Object.fromEntries(scores.map((s) => [s.id, s.title || s.file])), [scores]);
  const postersRunning = Boolean(posterRun?.running);

  const generatePosters = useCallback(async () => {
    if (postersRunning || !missingPosters.length || !posterHostRef.current) return;
    const rows = missingPosters.map(({ id }) => ({ id }));
    cancelPostersRef.current = false;
    setPosterRun({ running: true, index: 0, total: rows.length, saved: 0, failed: [], cancelled: false });
    logger.info('admin.sheetmusic.posters-start', { total: rows.length, filter });
    const result = await generateMissingPosters({
      rows,
      host: posterHostRef.current,
      fetchXml: fetchScoreXml,
      engrave: osmdEngrave,
      isCancelled: () => cancelPostersRef.current,
      onProgress: ({ index }) => { if (alive.current) setPosterRun((prev) => (prev ? { ...prev, index } : prev)); },
      logger,
    });
    logger.info('admin.sheetmusic.posters-done', {
      total: rows.length, saved: result.saved.length, failed: result.failed.length, cancelled: result.cancelled,
    });
    if (!alive.current) return;
    setPosterRun({
      running: false, index: rows.length, total: rows.length, saved: result.saved.length, failed: result.failed, cancelled: result.cancelled,
    });
    if (result.saved.length) reload();
  }, [postersRunning, missingPosters, logger, filter, reload]);

  const cancelPosters = useCallback(() => {
    cancelPostersRef.current = true;
    setPosterRun((prev) => (prev ? { ...prev, cancelling: true } : prev));
  }, []);

  const openScore = useCallback((score) => {
    logger.info('admin.sheetmusic.open', { id: score.id });
    navigate(scorePath(score.id));
  }, [logger, navigate]);

  const onUploaded = useCallback((result) => {
    setUploadOpen(false);
    notifications.show({ color: 'green', title: 'Score uploaded', message: result.title || result.filename || result.id });
    navigate(scorePath(result.id));
  }, [navigate]);

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>Sheet music</Title>
        <Group gap="xs">
          <Button
            variant="light"
            leftSection={<IconPhoto size={16} />}
            onClick={generatePosters}
            disabled={postersRunning || missingPosters.length === 0}
            data-testid="generate-missing-posters"
          >
            {`Generate missing posters (${missingPosters.length})`}
          </Button>
          <Tooltip
            label={loading ? 'Loading folders' : 'Folders could not be loaded. Retry first.'}
            disabled={folders.length > 0}
            withArrow
          >
            <span>
              <Button leftSection={<IconUpload size={16} />} onClick={() => setUploadOpen(true)} disabled={folders.length === 0}>
                Upload
              </Button>
            </span>
          </Tooltip>
        </Group>
      </Group>

      <PosterRun run={posterRun} titles={titles} onCancel={cancelPosters} onDismiss={() => setPosterRun(null)} />
      {/* Off-screen but laid out: OSMD measures the host while it engraves. */}
      <div
        ref={posterHostRef}
        aria-hidden="true"
        data-testid="poster-host"
        style={{ position: 'absolute', left: -100000, top: 0, width: POSTER_ENGRAVE_WIDTH, visibility: 'hidden', pointerEvents: 'none' }}
      />

      <SegmentedControl
        value={filter}
        onChange={setFilter}
        data={FILTERS.map((f) => ({ value: f.value, label: `${f.label} (${counts[f.value] ?? 0})` }))}
      />

      {loading && scores.length === 0 ? <LoadingSkeleton /> : null}

      {error ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Could not load the library">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{error}</Text>
            <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={reload} loading={loading}>Retry</Button>
          </Stack>
        </Alert>
      ) : null}

      {!loading && !error && scores.length === 0 ? (
        <Text c="dimmed" size="sm">No scores in the library yet.</Text>
      ) : null}
      {!loading && !error && scores.length > 0 && groups.length === 0 ? (
        <Text c="dimmed" size="sm">No scores match this filter.</Text>
      ) : null}

      {groups.length > 0 ? (
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Title</Table.Th>
              <Table.Th>Composer</Table.Th>
              <Table.Th>Format</Table.Th>
              <Table.Th>Poster</Table.Th>
              <Table.Th>Learn</Table.Th>
              <Table.Th>Learners</Table.Th>
              <Table.Th>Issues</Table.Th>
            </Table.Tr>
          </Table.Thead>
          {groups.map((g) => (
            <Table.Tbody key={g.name}>
              <Table.Tr>
                <Table.Th colSpan={7}><Text size="sm" fw={700} c="dimmed">{g.name}</Text></Table.Th>
              </Table.Tr>
              {g.rows.map((s) => <ScoreRow key={s.id} score={s} onOpen={openScore} />)}
            </Table.Tbody>
          ))}
        </Table>
      ) : null}

      <UploadModal
        opened={uploadOpen}
        onClose={() => setUploadOpen(false)}
        folders={folders}
        logger={logger}
        onUploaded={onUploaded}
      />
    </Stack>
  );
}
