#!/usr/bin/env python3
"""Durable wind-down session policy shared by the daemon and mpv.

All mutations use one flock and atomic replace. No player or Bluetooth side
 effects occur here: callers enact the resulting allowed/phase decision.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import time
import uuid


def fresh(now, max_seconds):
    return {'session_id': uuid.uuid4().hex, 'phase': 'primary', 'started_at': now,
            'deadline': now + max_seconds, 'disconnected_at': None,
            'resume': False, 'reason': None}


def transition(state, action, now, max_seconds=18000, reconnect_seconds=120):
    if state is None:
        if action not in ('ensure', 'connect'):
            return None
        return fresh(now, max_seconds)
    s = dict(state)
    gap = s.get('disconnected_at')
    # Only a real connection edge can reopen an intentionally ended session.
    # A brief unsolicited reconnect cannot undo completion or the battery stop.
    if action == 'connect' and gap is not None and now - gap > reconnect_seconds:
        return fresh(now, max_seconds)
    if s['phase'] != 'ended' and now >= s['deadline']:
        s.update(phase='ended', reason='max_duration', ended_at=now)
    if action == 'drop':
        if gap is None:
            s['disconnected_at'] = now
        return s
    if s['phase'] == 'ended':
        return s
    if action in ('connect', 'ensure'):
        if gap is not None and now - gap > reconnect_seconds:
            return fresh(now, max_seconds)
        s.update(resume=True, disconnected_at=None)
    elif action == 'fallback':
        s.update(phase='fallback', resume=False)
    elif action in ('eof', 'stop', 'error'):
        if action != 'eof' or s['phase'] == 'primary':
            s.update(phase='ended', reason={'eof': 'natural_end', 'stop': 'manual_stop',
                                          'error': 'media_error'}[action], ended_at=now)
    return s


def read_state(path):
    try:
        state = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    if (not isinstance(state, dict) or state.get('phase') not in ('primary', 'fallback', 'ended')
            or not isinstance(state.get('deadline'), (int, float))
            or not isinstance(state.get('started_at'), (int, float))
            or not isinstance(state.get('session_id'), str)
            or (state.get('disconnected_at') is not None
                and not isinstance(state['disconnected_at'], (int, float)))):
        raise ValueError('invalid session state')
    return state


def apply_policy(base, device, action, now=None, session_id=None):
    profile = device.get('wind_down')
    if not profile:
        return {'enabled': False, 'allowed': True}
    now = time.time() if now is None else now
    slot_dir = Path(base) / 'slots' / str(device['slot'])
    slot_dir.mkdir(parents=True, exist_ok=True)
    path = slot_dir / 'session.json'
    with (slot_dir / 'session.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        invalid_state = False
        try:
            state = read_state(path)
        except (ValueError, TypeError):
            invalid_state = True
            state = fresh(now, profile.get('max_session_seconds', 18000))
            state.update(phase='ended', reason='invalid_state', ended_at=now)
        accepted = not session_id or (state is not None and state['session_id'] == session_id)
        before = state
        if accepted:
            state = transition(state, action, now, profile.get('max_session_seconds', 18000),
                               profile.get('reconnect_seconds', 120))
        if state is not None and (invalid_state or state != before):
            # Unique temporary name plus flock: no shared .tmp race with another writer.
            tmp = path.with_suffix('.tmp')
            with tmp.open('w') as out:
                json.dump(state, out)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, path)
            if (before is None or before.get('phase') != state['phase']
                    or before.get('session_id') != state['session_id']):
                with (slot_dir / 'events.jsonl').open('a') as events:
                    events.write(json.dumps({'ts': datetime.fromtimestamp(now, timezone.utc).isoformat(),
                                             'evt': 'session.phase', 'slot': device['slot'],
                                             'phase': state['phase'], 'reason': state.get('reason'),
                                             'deadline': state['deadline'], 'session_id': state['session_id']}) + '\n')
        result = dict(state or {})
        phase = result.get('phase', 'idle')
        result.update(enabled=True, allowed=phase in ('primary', 'fallback'), accepted=accepted,
                      queue=profile['fallback_queue'] if phase == 'fallback' else device['queue'],
                      shuffle=phase == 'fallback')
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--slot', required=True, type=int)
    parser.add_argument('--action', required=True,
                        choices=['ensure', 'connect', 'drop', 'tick', 'fallback', 'eof', 'stop', 'error', 'status'])
    parser.add_argument('--session-id')
    args = parser.parse_args()
    base = Path(args.base)
    config = json.loads((base / '.devices.runtime.json').read_text())
    device = next(d for d in config['devices'] if d['slot'] == args.slot)
    print(json.dumps(apply_policy(base, device, args.action, session_id=args.session_id)))


if __name__ == '__main__':
    main()
