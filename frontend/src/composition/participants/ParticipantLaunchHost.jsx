import React, { useCallback, useEffect, useRef, useState } from 'react';
import { participantLaunchClient } from './participantLaunchClient.js';
import {TVActionDialog} from './TVActionDialog.jsx';

const allowConsumer = () => true;

/** Presents server-owned summaries and choices without interpreting consumer setup. */
export function ParticipantLaunchHost({ refValue, action, client = participantLaunchClient, onReady, onPassthrough, onClose, onConflict, requireConfirmation = false, canLaunch = allowConsumer, requestIdFactory = () => crypto.randomUUID() }) {
  const [state, setState] = useState({ phase: 'loading' });
  const id = useRef(null);
  const busy = useRef(null);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; return () => { generation.current += 1; }; }, []);
  const callbacks = useRef({onReady,onPassthrough,canLaunch,onConflict});
  callbacks.current = {onReady,onPassthrough,canLaunch,onConflict};
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
        setState(s => ({ phase: 'options', options: {...s.options, ready: true, confirmation: 'required', setup_hash: result.current_setup_hash, choices: result.choices} }));
      } else throw new Error('Invalid launch response');
    } catch (error) {
      if (generation.current !== requestGeneration) return;
      setState({ phase: ['setup_conflict','revision_conflict','agenda_not_launchable','invalid_participant_launch_ref'].includes(error.code) ? 'conflict' : 'error', message: error.message });
    } finally { if (busy.current === requestGeneration) busy.current = null; }
  }, [client]);
  useEffect(() => { execute('inspect', { ref: refValue, action }); }, [refValue, action, execute]);
  const recover = async () => {
    setState({phase:'loading'});
    try {
      if (!callbacks.current.onConflict) throw new Error('Refresh unavailable');
      await callbacks.current.onConflict();
    } catch (error) { setState({phase:'conflict',message:error.message}); }
  };
  const options = state.options;
  const begin = useCallback((intent) => {
    if (!id.current || intent === 'new') id.current = requestIdFactory();
    execute('begin', { ref: refValue, action, requestId: id.current, intent, expectedSetupHash: options?.setup_hash });
  }, [action, execute, options, refValue, requestIdFactory]);
  useEffect(() => {
    if (state.phase === 'options' && options.confirmation === 'none' && !options.choices?.length && !requireConfirmation) begin('open');
  }, [state.phase, options, begin, requireConfirmation]);
  return <TVActionDialog label="Activity launch" focusKey={state.phase} onBack={onClose}>
    {state.phase === 'loading' && <p>Loading activity…</p>}
    {state.phase === 'conflict' && <><p>{state.message}</p><button onClick={recover}>Refresh</button></>}
    {state.phase === 'error' && <><p>{state.message}</p><button onClick={() => execute(lastOperation.current.operation, lastOperation.current.input)}>Retry</button></>}
    {state.phase === 'options' && <>
      <p>Review activity</p>
      {options.participant_summary?.map(person => <p key={person.key}>{person.display?.name}</p>)}
      {options.consumer_summary?.data && <pre>{JSON.stringify(options.consumer_summary.data, null, 2)}</pre>}
      {options.choices?.map(choice => <button key={choice.launch_id} onClick={() => execute('resume', {ref:refValue,action,launchId:choice.launch_id})}>Resume {choice.label}</button>)}
      <button onClick={() => begin(options.choices?.length ? 'new' : 'open')}>{options.choices?.length ? 'New' : 'Start'}</button>
    </>}
    <button onClick={onClose}>Back</button>
  </TVActionDialog>;
}
