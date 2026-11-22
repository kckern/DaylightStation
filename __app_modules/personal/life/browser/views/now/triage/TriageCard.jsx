import { useEffect, useState } from 'react';
import { Anchor, Button, Group, Text, Textarea, UnstyledButton } from '@mantine/core';
import { IconExternalLink, IconCheck } from '@tabler/icons-react';
import { AnswerInput } from "./AnswerInput.jsx";
import { ActionLog } from "./ActionLog.jsx";

const LETTERS = 'ABCDEFGH';
export const DRY_RUN_NOTE = 'Dry run — nothing was done automatically; your taps are real.';

function ago(at) {
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const isReplyCard = (card) => card.kind === 'email' && card.step === 'reply';

function CardHead({ card }) {
  const d = card.display ?? {};
  const who = card.kind === 'email' ? (d.from?.name || d.from?.address || null) : null;
  // Only API-supplied display names: the source is the adapter's own label.
  const meta = [card.source ?? d.source ?? null, who, ago(d.at)].filter(Boolean).join(' · ');
  return (
    <div className="life-triage__head">
      {meta && <Text size="xs" c="dimmed" className="life-triage__meta">{meta}</Text>}
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Text fw={600} className="life-triage__title">{d.title || 'Untitled'}</Text>
        {d.url && (
          <Anchor href={d.url} target="_blank" rel="noopener noreferrer" aria-label="Open the original" className="life-triage__open">
            <IconExternalLink size={16} />
          </Anchor>
        )}
      </Group>
      {d.snippet && <div className="life-triage__snippet">{d.snippet}</div>}
      {card.why && <Text size="sm" className="life-triage__why">{card.why}</Text>}
    </div>
  );
}

function Choices({ card, onChoice, busy, exclude = [] }) {
  const list = (card.choices ?? []).filter((c) => !exclude.includes(c.key));
  return (
    <div className="life-triage__choices">
      {list.map((c, i) => {
        const suggested = c.key === card.suggested;
        return (
          <UnstyledButton
            key={c.key}
            className={`life-triage__choice${suggested ? ' life-triage__choice--suggested' : ''}`}
            onClick={() => onChoice(c.key)}
            disabled={busy}
          >
            <span className="life-triage__letter" aria-hidden>{LETTERS[i] ?? ''}</span>
            <span className="life-triage__choice-label">{c.label}</span>
            {suggested && <span className="life-triage__suggested">suggested</span>}
          </UnstyledButton>
        );
      })}
    </div>
  );
}

function ReplyBody({ card, busy, highlightSend, onSend, onSkip, onChoice }) {
  const [body, setBody] = useState(card.draftBody ?? '');
  const [editing, setEditing] = useState(!card.draftBody);
  // A new draft from the server (a voice/text revision) replaces what is shown.
  useEffect(() => { setBody(card.draftBody ?? ''); if (card.draftBody) setEditing(false); }, [card.draftBody]);
  const edited = body.trim() !== (card.draftBody ?? '').trim();
  const others = (card.choices ?? []).filter((c) => c.key !== 'send');
  return (
    <>
      {editing ? (
        <Textarea
          aria-label="Reply draft"
          className="life-triage__draft-edit"
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          readOnly={busy}
          autosize
          minRows={4}
          placeholder="Write the reply…"
          autoFocus={!!card.draftBody}
        />
      ) : (
        <div className="life-triage__draft" aria-label="Reply draft">{body}</div>
      )}
      <div className="life-triage__actions">
        <Button size="sm" variant="default" onClick={onSkip} disabled={busy}>Skip</Button>
        <Button size="sm" variant="default" onClick={() => setEditing((v) => !v)} disabled={busy}>{editing ? 'Done' : 'Edit'}</Button>
        <Button size="sm"
          color="green"
          className={highlightSend ? 'life-triage__send--highlight' : undefined}
          onClick={() => onSend(edited ? body.trim() : null)}
          disabled={busy || !body.trim()}
        >
          Send
        </Button>
      </div>
      {highlightSend && <Text size="sm" fw={600} c="green" mt={6}>Tap Send to send it.</Text>}
      {others.length > 0 && (
        <Group gap={6} mt="sm" className="life-triage__others">
          <Text size="xs" c="dimmed">Or:</Text>
          {others.map((c) => (
            <Button key={c.key} size="compact-sm" variant="subtle" onClick={() => onChoice(c.key)} disabled={busy}>{c.label}</Button>
          ))}
        </Group>
      )}
    </>
  );
}

function RecapBody({ card, mode, wouldHave, busy, onChoice, onUndo, onLoadLog }) {
  const [showLog, setShowLog] = useState(false);
  const dry = mode === 'dryRun';
  // A dry run did nothing on its own: show what it would have done, never "Archived N".
  const rows = dry
    ? [['Would have archived', wouldHave?.archived ?? 0], ['Would have closed', wouldHave?.closed ?? 0]]
    : [['Archived', card.counts?.archived ?? 0], ['Closed stale todos', card.counts?.closed ?? 0]];
  // Kept mail is real in both modes (nothing changes in the mailbox), so it is never "would have".
  if (card.counts?.kept) rows.push(['Left in inbox, no card needed', card.counts.kept]);
  return (
    <>
      <div className="life-triage__stats">
        {rows.map(([label, n]) => (
          <div key={label} className="life-triage__stat"><span>{!dry && <IconCheck size={14} aria-hidden />} {label}</span><span>{n}</span></div>
        ))}
      </div>
      {dry && <Text size="xs" c="dimmed" mt="xs">{DRY_RUN_NOTE}</Text>}
      {showLog && <div className="life-triage__log-wrap"><ActionLog loadLog={onLoadLog} onUndo={onUndo} /></div>}
      <div className="life-triage__actions">
        <Button size="sm" variant="default" onClick={() => setShowLog((v) => !v)} disabled={!onLoadLog}>
          {showLog ? 'Hide' : 'Review'}
        </Button>
        <Button size="sm" onClick={() => onChoice('ok')} disabled={busy}>Got it →</Button>
      </div>
    </>
  );
}

function ApplyingBody({ card, busy, onResolve }) {
  const what = card.answer?.choice === 'send' ? 'sending this reply' : 'making the todo';
  return (
    <div className="life-triage__doubt" role="group" aria-label="Did this go through?">
      <Text fw={600}>Did this go through?</Text>
      <Text size="sm" c="dimmed">We tried {what} but couldn&apos;t confirm it. Check, then tell us.</Text>
      <div className="life-triage__actions">
        <Button size="sm" variant="default" onClick={() => onResolve(false)} disabled={busy}>No, it didn&apos;t</Button>
        <Button size="sm" onClick={() => onResolve(true)} disabled={busy}>Yes, it did</Button>
      </div>
    </div>
  );
}

/**
 * One triage card: the item, why it is here, and the ways to answer it.
 * The caller owns the answer text (`text`) so nothing typed is lost across retries.
 */
export function TriageCard({
  card, mode, busy = false, text, onTextChange, onSubmitText, prompt = null, focusKey = null,
  highlightSend = false, onChoice, onSend, onSkip, onResolve, onUndo, onLoadLog = null, wouldHave = null,
}) {
  if (card.kind === 'recap') {
    return (
      <article className="life-triage__card">
        <Text fw={600} className="life-triage__title">{mode === 'dryRun' ? 'What I would have done' : 'Done for you'}</Text>
        <Text size="xs" c="dimmed">Since your last session</Text>
        <RecapBody card={card} mode={mode} wouldHave={wouldHave} busy={busy} onChoice={onChoice} onUndo={onUndo} onLoadLog={onLoadLog} />
      </article>
    );
  }
  const applying = card.applying === true || card.status === 'applying';
  const reply = isReplyCard(card);
  return (
    <article className="life-triage__card">
      <CardHead card={card} />
      {applying ? (
        <ApplyingBody card={card} busy={busy} onResolve={onResolve} />
      ) : (
        <>
          {reply
            ? <ReplyBody card={card} busy={busy} highlightSend={highlightSend} onSend={onSend} onSkip={onSkip} onChoice={onChoice} />
            : <Choices card={card} busy={busy} onChoice={onChoice} />}
          <AnswerInput
            value={text}
            onChange={onTextChange}
            onSubmit={onSubmitText}
            prompt={prompt}
            focusKey={focusKey}
            disabled={busy}
            placeholder={prompt ? 'e.g. "Read one review"' : reply ? 'Change it…' : 'Or say what to do…'}
            label={reply ? 'Answer in your own words, e.g. "make it shorter, ask about Friday"' : undefined}
          />
          {!reply && (
            <Button variant="subtle" size="compact-sm" color="gray" className="life-triage__skip" onClick={onSkip} disabled={busy}>Skip for now</Button>
          )}
        </>
      )}
    </article>
  );
}

export default TriageCard;
