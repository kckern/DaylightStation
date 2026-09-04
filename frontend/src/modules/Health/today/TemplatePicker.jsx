import { useEffect, useRef, useState } from 'react';
import { UnstyledButton, Button, Text } from '@mantine/core';
import { Sheet, LoadingState, EmptyState, ErrorState } from '@/lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { nutritionIconUrl } from './iconUrl.js';
import { TemplateEditor } from './TemplateEditor.jsx';
import { operationRequest } from '../capture/operationRequest.js';
import { FoodIcon } from './FoodIcon.jsx';

const logger = createAppLogger('health').child('template-picker');

const coreOf = (template) => (template.components || []).filter((c) => c.role === 'core');
const variantsOf = (template) => (template.components || []).filter((c) => c.role === 'variant');
const kcal = (components) => Math.round(components.reduce((s, c) => s + (Number(c.calories) || 0), 0));

/**
 * The single surface for meals (PRD F6.3) — it replaced `SavedMealsSheet`, so
 * everything that sheet did is here: list, item count, kcal, and one tap to log
 * into the bucket the picker was launched from.
 *
 * It adds what a saved meal could not express: mined PROPOSALS at the top with
 * Approve/Dismiss, and variant toggles before logging so the rotating half of a
 * stack is a choice rather than a re-itemization.
 */
/**
 * @param {Object} props
 * @param {string} [props.focusTemplateId] - opened straight onto this template
 *   (the add-combobox picked it), so a meal suggestion still gets its variant
 *   step rather than logging one silent arrangement of itself.
 */
export function TemplatePicker({ open, onClose, onLogged, bucketId, date = null, focusTemplateId = null }) {
  const { data, loading, reload, error: loadError } = useApiResource(
    open ? 'api/v1/health/nutrition/templates?includeProposed=1' : null,
    { deps: [open], label: 'meal-templates', logger },
  );
  // template | null — the one whose variants are being chosen.
  const [chosen, setChosen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [variants, setVariants] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submitting = useRef(false);
  const requestRef = useRef(null);

  const templates = data?.templates || [];
  // Honour `focusTemplateId` once per opening. A ref, not state derived from
  // props: re-running it on every render would fight the Back button.
  const focused = useRef(null);
  useEffect(() => {
    if (!open) { focused.current = null; return; }
    if (!focusTemplateId || focused.current === focusTemplateId) return;
    const target = templates.find((t) => t.id === focusTemplateId && t.status !== 'proposed');
    if (!target) return;
    focused.current = focusTemplateId;
    openTemplate(target);
  }, [open, focusTemplateId, templates]);
  const proposals = templates.filter((t) => t.status === 'proposed');
  const active = templates.filter((t) => t.status !== 'proposed');

  const close = () => { setEditing(null); setChosen(null); setVariants(new Set()); setError(null); onClose(); };

  const openTemplate = (template) => {
    setError(null);
    // A template with nothing to choose has no decision in it, so it logs on
    // the first tap — the one-tap path the saved-meals sheet had.
    if (variantsOf(template).length === 0) { log(template, []); return; }
    setChosen(template);
    const offered = new Set(variantsOf(template).map(component => component.name));
    setVariants(new Set((template.variantsByBucket?.[bucketId] || []).filter(name => offered.has(name))));
  };

  const toggleVariant = (name) => setVariants((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  // What "Log" would actually write. An all-variant template with nothing
  // toggled would otherwise offer a button that writes a lone empty group; the
  // service refuses it too, but the button should never have been live.
  const selection = chosen
    ? [...coreOf(chosen), ...variantsOf(chosen).filter((c) => variants.has(c.name))]
    : [];

  const log = async (template, variantNames) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      await DaylightAPI(`api/v1/health/nutrition/templates/${template.id}/instantiate`,
        // Instantiate onto the day being VIEWED. The route has always taken a
      // `date`; nothing was sending one, so every template landed on today.
      operationRequest(requestRef, { ...(bucketId ? { mealTime: bucketId } : {}), ...(date ? { date } : {}), variantNames, templateId: template.id }), 'POST');
      requestRef.current = null;
      logger.info('template.logged', { id: template.id, bucket: bucketId ?? null, variants: variantNames.length });
      setChosen(null); setVariants(new Set());
      onLogged();
    } catch (err) {
      logger.error('template.log_failed', { id: template.id, error: err?.message });
      setError(err);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const decide = async (proposal, verdict) => {
    setBusy(true); setError(null);
    try {
      await DaylightAPI(`api/v1/health/nutrition/templates/${proposal.id}/${verdict}`, {}, 'POST');
      logger.info('proposal.decided', { id: proposal.id, verdict });
      reload();
    } catch (err) {
      logger.error('proposal.decide_failed', { id: proposal.id, verdict, error: err?.message });
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const icon = (template) => (template.icon ? nutritionIconUrl(template.icon) : null);

  return (
    <Sheet open={open} onClose={close} title={chosen ? chosen.name : 'Meals & templates'}>
      {error ? <p className="health-suggest__error">{error.message}</p> : null}
      {loadError ? <ErrorState error={loadError} onRetry={reload} label="Meals unavailable" /> : null}

      {editing ? <TemplateEditor key={editing.id} template={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : chosen ? (
        <div className="health-templates__variants">
          <p className="health-templates__hint">
            {coreOf(chosen).length > 0
              ? `${coreOf(chosen).length} always included. Add anything else you want today.`
              : 'Nothing is always included — pick at least one.'}
          </p>
          <ul className="health-templates__list">
            {variantsOf(chosen).map((component) => {
              const on = variants.has(component.name);
              return (
                <li key={component.name}>
                  <UnstyledButton
                    className={`health-templates__toggle${on ? ' health-templates__toggle--on' : ''}`}
                    role="switch" aria-checked={on} onClick={() => toggleVariant(component.name)}>
                    <span className="health-templates__check" aria-hidden="true">{on ? '✓' : '+'}</span>
                    <span>{component.name}</span>
                    <span className="health-suggest__kcal">{Math.round(Number(component.calories) || 0)}</span>
                  </UnstyledButton>
                </li>
              );
            })}
          </ul>
          <div className="health-templates__actions">
            <Button size="sm" disabled={busy || selection.length === 0}
              onClick={() => log(chosen, [...variants])}>
              {`Log ${kcal(selection)} kcal`}
            </Button>
            <Button size="sm" variant="subtle" disabled={busy} onClick={() => { setChosen(null); setVariants(new Set()); }}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <>
          {loading ? <LoadingState label="meals" /> : null}
          {!loading && !loadError && templates.length === 0 ? (
            <EmptyState title="No meals or templates yet"
              hint="Save one from a meal's ⋯ menu, or wait for a suggestion." />
          ) : null}

          {proposals.length > 0 ? (
            <section className="health-templates__proposals">
              <h3 className="health-pending__heading">Suggested</h3>
              {proposals.map((proposal) => (
                <div key={proposal.id} className="health-templates__proposal">
                  <div className="health-templates__proposal-info">
                    <span>{proposal.name}</span>
                    <Text size="xs" c="dimmed">
                      {`${coreOf(proposal).length} items · logged ${proposal.occurrences || 0}×`}
                    </Text>
                  </div>
                  <div className="health-templates__actions">
                    <Button size="xs" disabled={busy} onClick={() => decide(proposal, 'approve')}>Keep</Button>
                    <Button size="xs" variant="subtle" disabled={busy} onClick={() => decide(proposal, 'dismiss')}>
                      No thanks
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {active.map((template) => (
            <div key={template.id}>
            <UnstyledButton className="health-suggest__item" disabled={busy}
              onClick={() => openTemplate(template)}>
              <FoodIcon icon={template.icon} className="health-suggest__icon" />
              <span>{template.name}</span>
              <Text size="xs" c="dimmed" ml="auto">
                {`${coreOf(template).length} items · ${kcal(coreOf(template))} kcal`}
              </Text>
            </UnstyledButton>
            <Button size="compact-xs" variant="subtle" disabled={busy} onClick={() => setEditing(template)} aria-label={`Edit ${template.name}`}>Edit</Button>
            <Button size="compact-xs" variant="subtle" color="red" disabled={busy} onClick={async () => {
              if (!window.confirm(`Delete saved meal ${template.name}? Logged food will stay unchanged.`)) return;
              setBusy(true);
              try { await DaylightAPI(`api/v1/health/nutrition/templates/${template.id}`, {}, 'DELETE'); reload(); }
              catch (err) { setError(err); } finally { setBusy(false); }
            }} aria-label={`Delete ${template.name}`}>Delete</Button>
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}
export default TemplatePicker;
