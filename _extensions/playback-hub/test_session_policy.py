import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from session_policy import transition, apply_policy

PROFILE = {'slot': 7, 'color': 'white', 'queue': '767429', 'shuffle': False,
           'wind_down': {'fallback_queue': '697317', 'max_session_seconds': 18000,
                         'reconnect_seconds': 120}}

class SessionTests(unittest.TestCase):
    def start(self, now=100):
        return transition(None, 'ensure', now)

    def test_fresh_starts_primary(self):
        s = self.start()
        self.assertEqual(s['phase'], 'primary')
        self.assertEqual(s['deadline'], 18100)
        self.assertFalse(s['resume'])

    def test_fallback_does_not_extend_deadline(self):
        s = transition(self.start(), 'fallback', 150)
        self.assertEqual(s['phase'], 'fallback')
        self.assertEqual(s['deadline'], 18100)

    def test_natural_primary_end_is_terminal(self):
        s = transition(self.start(), 'eof', 200)
        self.assertEqual(s['phase'], 'ended')
        self.assertEqual(s['reason'], 'natural_end')
        self.assertEqual(transition(s, 'ensure', 201)['phase'], 'ended')
        self.assertEqual(transition(s, 'fallback', 201)['phase'], 'ended')

    def test_fallback_eof_keeps_playing(self):
        s = transition(self.start(), 'fallback', 110)
        self.assertEqual(transition(s, 'eof', 200)['phase'], 'fallback')

    def test_deadline_wins_even_during_pause_or_next(self):
        for action in ['tick', 'ensure', 'fallback', 'eof']:
            s = transition(self.start(), action, 18100)
            self.assertEqual(s['phase'], 'ended')
            self.assertEqual(s['reason'], 'max_duration')

    def test_dropouts_keep_phase_position_and_clock(self):
        s = transition(self.start(), 'fallback', 110)
        s = transition(s, 'drop', 200)
        s = transition(s, 'drop', 240)
        self.assertEqual(s['disconnected_at'], 200)
        resumed = transition(s, 'connect', 300)
        self.assertEqual(resumed['phase'], 'fallback')
        self.assertEqual(resumed['deadline'], 18100)
        self.assertTrue(resumed['resume'])
        self.assertIsNone(resumed['disconnected_at'])

    def test_long_disconnection_is_fresh(self):
        s = transition(transition(self.start(), 'fallback', 110), 'drop', 200)
        fresh = transition(s, 'connect', 321)
        self.assertEqual(fresh['phase'], 'primary')
        self.assertEqual(fresh['deadline'], 18321)
        self.assertNotEqual(fresh['session_id'], s['session_id'])
        self.assertFalse(fresh['resume'])

    def test_terminal_cannot_reconnect_itself(self):
        s = transition(transition(self.start(), 'eof', 200), 'drop', 201)
        self.assertEqual(transition(s, 'connect', 210)['phase'], 'ended')
        self.assertEqual(transition(s, 'ensure', 400)['phase'], 'ended')
        self.assertEqual(transition(s, 'connect', 400)['phase'], 'primary')

    def test_restart_preserves_active_phase_and_cutoff(self):
        s = transition(self.start(), 'fallback', 200)
        restored = transition(json.loads(json.dumps(s)), 'ensure', 300)
        self.assertEqual(restored['phase'], 'fallback')
        self.assertEqual(restored['deadline'], 18100)
        self.assertTrue(restored['resume'])
        self.assertEqual(transition(restored, 'ensure', 18101)['phase'], 'ended')

    def test_disk_persistence_and_stale_event_rejection(self):
        with tempfile.TemporaryDirectory() as td:
            first = apply_policy(Path(td), PROFILE, 'ensure', now=100)
            self.assertEqual(first['queue'], '767429')
            self.assertFalse(first['shuffle'])
            second = apply_policy(Path(td), PROFILE, 'fallback', now=200,
                                  session_id=first['session_id'])
            self.assertEqual(second['queue'], '697317')
            self.assertTrue(second['shuffle'])
            stale = apply_policy(Path(td), PROFILE, 'eof', now=210, session_id='old')
            self.assertEqual(stale['phase'], 'fallback')
            self.assertFalse(stale['accepted'])
            ended = apply_policy(Path(td), PROFILE, 'tick', now=18100)
            self.assertFalse(ended['allowed'])
            self.assertEqual(ended['reason'], 'max_duration')

    def test_corrupt_state_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)/'slots'/'7'
            p.mkdir(parents=True)
            (p/'session.json').write_text('broken')
            s = apply_policy(Path(td), PROFILE, 'ensure', now=100)
            self.assertFalse(s['allowed'])
            self.assertEqual(s['reason'], 'invalid_state')

    def test_health_ticks_do_not_rewrite_unchanged_state(self):
        with tempfile.TemporaryDirectory() as td:
            apply_policy(Path(td), PROFILE, 'ensure', now=100)
            path = Path(td)/'slots'/'7'/'session.json'
            before = path.stat().st_mtime_ns
            apply_policy(Path(td), PROFILE, 'tick', now=101)
            self.assertEqual(path.stat().st_mtime_ns, before)

    def test_unconfigured_devices_unchanged(self):
        with tempfile.TemporaryDirectory() as td:
            s = apply_policy(Path(td), {'slot': 1}, 'ensure', now=100)
            self.assertFalse(s['enabled'])
            self.assertTrue(s['allowed'])

class ValidationTests(unittest.TestCase):
    def test_rejects_unsafe_profile_values(self):
        import yaml
        for change in [{'fallback_queue': ''}, {'max_session_seconds': 0},
                       {'max_session_seconds': True}, {'reconnect_seconds': -1},
                       {'reconnect_seconds': '120'}]:
            device = copy.deepcopy(PROFILE)
            device['wind_down'].update(change)
            with tempfile.TemporaryDirectory() as td:
                p = Path(td)/'config.yml'
                p.write_text(yaml.safe_dump({'devices': [device]}))
                result = subprocess.run([sys.executable, str(Path(__file__).with_name('validate_config.py')), str(p)],capture_output=True)
                self.assertNotEqual(result.returncode, 0, change)


if __name__ == '__main__':
    unittest.main()
