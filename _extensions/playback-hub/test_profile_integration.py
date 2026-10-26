import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

MODULE = Path(__file__).resolve().parent
DEVICE = {'slot':7,'color':'white','mac':'AA:BB:CC:DD:EE:07','name':'musiCozy',
          'queue':'767429','shuffle':False,'wind_down':{'fallback_queue':'697317'}}

class ShellIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        (self.base/'.devices.runtime.json').write_text(json.dumps({'devices':[DEVICE]}))
        self.env = dict(os.environ, PLAYBACK_HUB_DIR=str(self.base))

    def shell(self, code):
        return subprocess.run(['bash','-c', 'source "$1/playback-hub.sh"\n'+code,
                               'test',str(MODULE)],env=self.env,capture_output=True,text=True)

    def test_phase_selects_queue_and_shuffle(self):
        p=self.base/'slots'/'7'; p.mkdir(parents=True)
        (p/'session.json').write_text(json.dumps({'phase':'fallback'}))
        r=self.shell('d=$(jq -c ".devices[0]" "$CONFIG_FILE"); selected_queue "$d"; selected_shuffle "$d"')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('/697317',r.stdout)
        self.assertTrue(r.stdout.rstrip().endswith('true'),r.stdout)

    def test_primary_cache_failure_cannot_shorten_wind_down(self):
        r=self.shell('''
log() { :; }; logev() { :; }
get_cached_path() { [[ "$1" == 1 ]] && echo /cache/1.mp3; }
q='{"items":[{"contentId":"plex:1","mediaUrl":"/one","title":"one"},{"contentId":"plex:2","mediaUrl":"/two","title":"two"}]}'
rebuild_playlist_from_queue 7 white "$q" false
''')
        self.assertNotEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertFalse((self.base/'slots'/'7'/'playlist.m3u').exists())

    def test_terminal_start_does_not_spawn_player(self):
        r=self.shell('''
python3 "$_SCRIPT_DIR/session_policy.py" --base "$BASE_DIR" --slot 7 --action ensure >/dev/null
python3 "$_SCRIPT_DIR/session_policy.py" --base "$BASE_DIR" --slot 7 --action eof >/dev/null
flock() { return 0; }; log() { :; }; logev() { :; }
pgrep() { touch "$BASE_DIR/player_was_probed"; return 1; }
start_playback 7 white AA:BB:CC:DD:EE:07 ignored false || true
''')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertFalse((self.base/'player_was_probed').exists())

class ControlIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import sys
        sys.path.insert(0,str(MODULE))
        import avrcp_dispatch
        cls.avrcp=avrcp_dispatch

    def test_next_key_variants_use_same_profile_message(self):
        for key in [self.avrcp.KEY_NEXTSONG,self.avrcp.KEY_FORWARD,self.avrcp.KEY_FASTFORWARD]:
            self.assertEqual(self.avrcp.command_for_key(key, True), ['script-message','hub-next'])
            self.assertEqual(self.avrcp.command_for_key(key, False), ['playlist-next'])

class DashboardIntegration(unittest.TestCase):
    def test_next_does_not_refresh_or_replace_profile_playlist(self):
        import web
        from unittest.mock import patch
        handler = web.Handler.__new__(web.Handler)
        handler._json = lambda *args: None
        with patch.object(web, 'read_devices', return_value=[DEVICE]), \
             patch.object(web, 'refresh_queue') as refresh, \
             patch.object(web, 'mpv_command', return_value={'error':'success'}) as command:
            handler._playback(7, 'next')
            refresh.assert_not_called()
            self.assertEqual(command.call_args.args[1], ['script-message','hub-next'])

class StartupSafety(unittest.TestCase):
    def test_cutoff_guard_starts_before_initial_player(self):
        source=(MODULE/'playback-hub.sh').read_text()
        monitor=source[source.index('monitor() {'):]
        self.assertLess(monitor.index('profile_loop &'), monitor.index('start_playback "$slot"'))

class ResumeIdentity(unittest.TestCase):
    setUp = ShellIntegration.setUp
    shell = ShellIntegration.shell
    def test_resume_rejects_primary_position_for_fallback_phase(self):
        p=self.base/'slots'/'7';p.mkdir(parents=True)
        (p/'state.json').write_text(json.dumps({'session_id':'same','phase':'primary','track':1,'position':900}))
        r=self.shell('profile_resume_allowed 7 \'{"session_id":"same","phase":"fallback"}\'')
        self.assertNotEqual(r.returncode,0)
        (p/'state.json').write_text(json.dumps({'session_id':'same','phase':'fallback','track':1,'position':9}))
        r=self.shell('profile_resume_allowed 7 \'{"session_id":"same","phase":"fallback"}\'')
        self.assertEqual(r.returncode,0,r.stderr)
