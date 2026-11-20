import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UnstyledButton, Button, Text } from '@mantine/core';
import { Sheet, SubmitButton, LoadingState, EmptyState, ErrorState, useRetryRegion, useSheetSubmission } from '@/lib/ui';
import { invalidateApiResources, useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { nutritionIconUrl } from "./iconUrl.js";
import { TemplateEditor } from "./TemplateEditor.jsx";
import { operationRequest } from "../capture/operationRequest.js";
import { useHealthSessionGuard } from '../operations/HealthOperationsProvider.jsx';
import { healthDayPath } from '../healthResources.js';
import { FoodIcon } from "./FoodIcon.jsx";

const logger = createAppLogger('health').child('template-picker');
const templatesPath = 'api/v1/health/nutrition/templates?includeProposed=1';

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
  const operations = useRef(new Map());
  const isSessionActive = useHealthSessionGuard();

  const instantiate = (template, variantNames) => {
    // A dismissed sheet and its replacement can have independent writes. An
    // identical pending or unconfirmed request retains its operation ID.
    const payload = {
      ...(bucketId ? { mealTime: bucketId } : {}),
      ...(date ? { date } : {}),
      variantNames: [...variantNames].sort(),
      templateId: template.id,
    };
    const key = JSON.stringify(payload);
    const operation = operations.current.get(key) ?? { body: operationRequest({ current: null }, payload) };
    if (operation.pending) return operation.pending;
    operations.current.set(key, operation);
    operation.pending = DaylightAPI(`api/v1/health/nutrition/templates/${template.id}/instantiate`, operation.body, 'POST').then(logged => {
      operations.current.delete(key);
      logger.info('template.logged', { id: template.id, bucket: bucketId ?? null, variants: variantNames.length });
      if (isSessionActive() && (date || logged?.date)) {
        const path = healthDayPath(logged?.date || date);
        invalidateApiResources(candidate => candidate === path);
      }
      return logged;
    }, error => {
      operation.pending = null;
      logger.error('template.log_failed', { id: template.id, error: error?.message });
      throw error;
    });
    return operation.pending;
  };

  return open ? <TemplatePickerVisit key={JSON.stringify([date, bucketId, focusTemplateId])}
    bucketId={bucketId} focusTemplateId={focusTemplateId} instantiate={instantiate}
    isSessionActive={isSessionActive} onLogged={onLogged} onClose={onClose} /> : null;
}

function TemplatePickerVisit({ onClose, onLogged, bucketId, focusTemplateId, instantiate, isSessionActive }) {
  const { data, loading, revalidating, reload, refresh, error: loadError } = useApiResource(
    templatesPath, { label: 'meal-templates', logger },
  );
  // template | null — the one whose variants are being chosen.
  const [chosen, setChosen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [variants, setVariants] = useState(() => new Set());
  const { run, saving: busy, failure: error, clearFailure } = useSheetSubmission(onClose);
  const reading = loading || revalidating;
  const listCommandsUnavailable = busy || reading || Boolean(loadError);
  const { regionProps, focus, retry } = useRetryRegion(reload, busy || reading);
  const scrollRef = useRef(null);
  const visitActive = useRef(false);
  const lastFocusedControl = useRef(null);
  useLayoutEffect(() => {
    visitActive.current = true;
    return () => { visitActive.current = false; };
  }, []);

  useLayoutEffect(() => {
    const previous = lastFocusedControl.current;
    if (!previous || previous.isConnected) return;
    lastFocusedControl.current = null;
    if (previous.ownerDocument.activeElement === previous.ownerDocument.body) focus();
  });

  function retireFocus(event) {
    const previous = event.target;
    // A normal blur leaves the control mounted. A read can remove it in the
    // same commit, which gives the region a chance to recover its focus.
    queueMicrotask(() => {
      if (lastFocusedControl.current === previous && previous.isConnected) lastFocusedControl.current = null;
    });
  }

  function revealContent() {
    focus();
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }

  function showEditor(template, { afterSave = false } = {}) {
    // The same region owns focus on either side of the editor transition.
    // If focus moved to the sheet controls during a save, leave it there.
    const region = regionProps.ref.current;
    if (!afterSave || region?.contains(region.ownerDocument.activeElement)) revealContent();
    setEditing(template);
  }

  const templates = data?.templates || [];
  // Honour `focusTemplateId` once per opening. A ref, not state derived from
  // props: re-running it on every render would fight the Back button.
  const focused = useRef(null);
  useEffect(() => {
    if (!focusTemplateId || focused.current === focusTemplateId) return;
    const target = templates.find((t) => t.id === focusTemplateId && t.status !== 'proposed');
    if (!target) return;
    focused.current = focusTemplateId;
    openTemplate(target);
  }, [focusTemplateId, templates]);
  const proposals = templates.filter((t) => t.status === 'proposed');
  const active = templates.filter((t) => t.status !== 'proposed');

  const openTemplate = (template, fromControl = false) => {
    clearFailure();
    // A template with nothing to choose has no decision in it, so it logs on
    // the first tap — the one-tap path the saved-meals sheet had.
    if (variantsOf(template).length === 0) { log(template, [], fromControl); return; }
    if (fromControl) revealContent();
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

  const log = (template, variantNames, fromControl) => run(() => {
    if (fromControl) focus();
    return instantiate(template, variantNames);
  }, {
    onSuccess: logged => {
      if (!isSessionActive()) return;
      setChosen(null);
      setVariants(new Set());
      onLogged(logged);
      onClose();
    },
  });

  const refreshTemplates = () => {
    if (isSessionActive()) invalidateApiResources(path => path === templatesPath);
  };
  const changeTemplates = command => run(async () => {
    focus();
    await command();
    if (!isSessionActive()) return;
    if (!visitActive.current) {
      refreshTemplates();
      return;
    }
    try {
      await refresh();
    } catch {
      // The reader reports the refused GET and owns its Retry action.
    }
  }, { valid: !listCommandsUnavailable, onSuccess: null });

  const decide = (proposal, verdict) => changeTemplates(async () => {
    try {
      await DaylightAPI(`api/v1/health/nutrition/templates/${proposal.id}/${verdict}`, {}, 'POST');
      logger.info('proposal.decided', { id: proposal.id, verdict });
    } catch (err) {
      logger.error('proposal.decide_failed', { id: proposal.id, verdict, error: err?.message });
      throw err;
    }
  });

  const deleteTemplate = template => {
    if (!window.confirm(`Delete saved meal ${template.name}? Logged food will stay unchanged.`)) return;
    void changeTemplates(() => DaylightAPI(`api/v1/health/nutrition/templates/${template.id}`, {}, 'DELETE'));
  };

  const icon = (template) => (template.icon ? nutritionIconUrl(template.icon) : null);

  return (
    <Sheet open onClose={onClose} title={chosen ? chosen.name : 'Meals & templates'} scrollRef={scrollRef}>
      <section aria-label="Saved meals" {...regionProps}
        onFocusCapture={event => { lastFocusedControl.current = event.target; }} onBlurCapture={retireFocus}>
        {error ? <p className="health-suggest__error" role="alert">{error.message}</p> : null}
        {loadError ? <ErrorState error={loadError} onRetry={retry} label="Meals unavailable" /> : null}

        {editing ? (
          <TemplateEditor key={editing.id} template={editing} onCommitted={refreshTemplates}
            onClose={() => showEditor(null, { afterSave: true })} onCancel={() => showEditor(null)} />
        ) : chosen ? (
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
                onClick={() => log(chosen, [...variants], true)}>
                {`Log ${kcal(selection)} kcal`}
              </Button>
              <Button size="sm" variant="subtle" disabled={busy} onClick={() => {
                revealContent();
                setChosen(null);
                setVariants(new Set());
              }}>
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
                      <SubmitButton as={Button} type="button" size="xs" blocked={listCommandsUnavailable}
                        onClick={() => decide(proposal, 'approve')}>Keep</SubmitButton>
                      <SubmitButton as={Button} type="button" size="xs" variant="subtle" blocked={listCommandsUnavailable}
                        onClick={() => decide(proposal, 'dismiss')}>
                        No thanks
                      </SubmitButton>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {active.map((template) => (
              <div key={template.id}>
                <UnstyledButton className="health-suggest__item" disabled={busy}
                  onClick={() => openTemplate(template, true)}>
                  <FoodIcon icon={template.icon} className="health-suggest__icon" />
                  <span>{template.name}</span>
                  <Text size="xs" c="dimmed" ml="auto">
                    {`${coreOf(template).length} items · ${kcal(coreOf(template))} kcal`}
                  </Text>
                </UnstyledButton>
                <Button size="compact-xs" variant="subtle" disabled={busy} onClick={() => showEditor(template)} aria-label={`Edit ${template.name}`}>Edit</Button>
                <SubmitButton as={Button} type="button" size="compact-xs" variant="subtle" color="red" blocked={listCommandsUnavailable}
                  onClick={() => deleteTemplate(template)} aria-label={`Delete ${template.name}`}>Delete</SubmitButton>
              </div>
            ))}
          </>
        )}
      </section>
    </Sheet>
  );
}
export default TemplatePicker;
