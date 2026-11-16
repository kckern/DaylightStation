import React, { useCallback, useEffect, useRef, useState } from 'react';
import { participantLaunchClient } from './participantLaunchClient.js';

const allowConsumer = () => true;

/** Presents server-owned summaries and choices without interpreting consumer setup. */
export function ParticipantLaunchHost({ refValue, action, client = participantLaunchClient, onReady, onPassthrough, onClose, canLaunch = allowConsumer, requestIdFactory = () => crypto.randomUUID() }) {
  const [state, setState] = useState({ phase: 'loading' });
  const dialog = useRef(null);
  const id = useRef(null);
  const busy = useRef(null);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; return () => { generation.current += 1; }; }, []);
  const callbacks = useRef({onReady,onPassthrough,canLaunch});
  callbacks.current = {onReady,onPassthrough,canLaunch};
  const lastOperation = useRef(null);
  const inspectedConsumer = useRef(null);
  const execute = useCallback(async (operation, input) => {
    const requestGeneration = generation.current;
    if (busy.current === requestGeneration) return;
    busy.current = requestGeneration;
    lastOperation.current = { operation, input };
    setState(s => ({ ...s, phase: 'loading' }));
    try {
      const result = await client[operation](input);
      if (generation.current !== requestGeneration) return;
      if (operation === 'inspect') {
        if (result.schema !== 'participant-launch-options/v1' || !result.ready || !['required','none'].includes(result.confirmation) || !callbacks.current.canLaunch(result.consumer)) throw new Error('Launch unavailable');
        inspectedConsumer.current = result.consumer;
        setState({ phase: 'options', options: result });
      } else if (result.schema === 'participant-launch-result/v1' && result.kind === 'ready') {
        callbacks.current.onReady?.(result);
      } else if (result.schema === 'participant-launch-result/v1' && result.kind === 'passthrough') {
        if (!callbacks.current.onPassthrough) throw new Error('Launch unavailable');
        callbacks.current.onPassthrough(result, inspectedConsumer.current);
      } else if (result.schema === 'participant-launch-result/v1' && result.kind === 'resume_available') {
        setState({ phase: 'options', options: { ready: true, confirmation: 'required', setup_hash: result.current_setup_hash, choices: result.choices } });
      } else throw new Error('Invalid launch response');
    } catch (error) {
      if (generation.current !== requestGeneration) return;
      setState({ phase: 'error', message: error.message });
    } finally { if (busy.current === requestGeneration) busy.current = null; }
  }, [client]);
  useEffect(() => { execute('inspect', { ref: refValue, action }); }, [refValue, action, execute]);
  const options = state.options;
  const begin = useCallback((intent) => {
    if (!id.current) id.current = requestIdFactory();
    execute('begin', { ref: refValue, action, requestId: id.current, intent, expectedSetupHash: options?.setup_hash });
  }, [action, execute, options, refValue, requestIdFactory]);
  useEffect(() => {
    if (state.phase === 'options' && options.confirmation === 'none' && !options.choices?.length) begin('new');
  }, [state.phase, options, begin]);
  useEffect(() => {
    dialog.current?.querySelector('button')?.focus();
  }, [state.phase]);
  const handleKeys = event => {
    if (event.key === 'Escape' || event.key === 'GoBack') { event.preventDefault(); event.stopPropagation(); onClose?.(); return; }
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
    const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault(); event.stopPropagation();
    const step = ['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1;
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + step + buttons.length) % buttons.length].focus();
  };
  return <div ref={dialog} role="dialog" aria-label="Activity launch" onKeyDown={handleKeys}>
    {state.phase === 'loading' && <p>Loading activity…</p>}
    {state.phase === 'error' && <><p>{state.message}</p><button onClick={() => execute(lastOperation.current.operation, lastOperation.current.input)}>Retry</button></>}
    {state.phase === 'options' && <>
      <p>Review activity</p>
      {options.participant_summary?.map(person => <p key={person.key}>{person.display?.name}</p>)}
      {options.consumer_summary?.data && <pre>{JSON.stringify(options.consumer_summary.data, null, 2)}</pre>}
      {options.choices?.map(choice => <button key={choice.launch_id} onClick={() => execute('resume', {ref:refValue,action,launchId:choice.launch_id})}>Resume {choice.label}</button>)}
      <button onClick={() => begin('new')}>{options.choices?.length ? 'New' : 'Start'}</button>
    </>}
    <button onClick={onClose}>Back</button>
  </div>;
}
