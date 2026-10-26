#!/usr/bin/env python3
"""Real-mpv integration checks using synthetic WAVs and a null audio sink.

Run explicitly on Linux with mpv, socat, jq, flock, and Python available.
No production files, Bluetooth devices, or speakers are touched.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import wave

from session_policy import apply_policy

SOURCE = Path(__file__).resolve().parent

class PlayerRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='white-mpv-')
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.slot = self.base/'slots'/'7'
        self.slot.mkdir(parents=True)
        self.device = {'slot':7,'color':'white','name':'test','mac':'AA:BB:CC:DD:EE:07',
                       'queue':'100001','shuffle':False,'wind_down':{'fallback_queue':'100002',
                       'max_session_seconds':18000}}
        shutil.copy(SOURCE/'session_policy.py',self.base/'session_policy.py')
        for name in ('primary1','primary2','fallback1','fallback2'):
            with wave.open(str(self.base/(name+'.wav')),'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000)
                wav.writeframes(b'\0\0'*16000) # two seconds, decoded by real mpv
        self.primary=self.slot/'playlist.m3u'
        self.primary.write_text('\n'.join(str(self.base/(n+'.wav')) for n in ['primary1','primary2'])+'\n')
        (self.base/'fallback.m3u').write_text('\n'.join(str(self.base/(n+'.wav')) for n in ['fallback1','fallback2'])+'\n')
        # Exercise the production Bash handoff and IPC, substituting only the
        # network cache fetch with a prepared local playlist.
        (self.base/'playback-hub.sh').write_text('source '+str(SOURCE/'playback-hub.sh')+'\n'
            'fetch_and_cache() { cp "$BASE_DIR/fallback.m3u" "$(slot_dir "$1")/playlist.m3u"; }\n'
            'profile_fallback "$2" "$3"\n')
        self.proc=None
        self.addCleanup(self.cleanup_player)

    def cleanup_player(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        if hasattr(self,'log'): self.log.close()

    def start(self, seconds=18000, phase='primary'):
        self.device['wind_down']['max_session_seconds']=seconds
        (self.base/'.devices.runtime.json').write_text(json.dumps({'devices':[self.device]}))
        self.state=apply_policy(self.base,self.device,'ensure')
        if phase=='fallback': self.state=apply_policy(self.base,self.device,'fallback')
        opts=f'wind_down-base={self.base},wind_down-slot=7,wind_down-session_id={self.state["session_id"]}'
        self.log=(self.base/'mpv.log').open('w')
        env=dict(os.environ,PLAYBACK_HUB_DIR=str(self.base))
        self.proc=subprocess.Popen(['mpv','--no-config','--no-video','--no-terminal','--ao=null',
            '--load-scripts=no','--script='+str(SOURCE/'wind_down.lua'),'--script-opts='+opts,
            '--input-ipc-server='+str(self.slot/'mpv-socket'),
            '--loop-playlist='+('inf' if phase=='fallback' else 'no'),
            '--playlist='+str(self.primary)],stdout=self.log,stderr=self.log,env=env)
        self.until(lambda:self.prop('playlist-pos')==0)

    def command(self,command):
        try:
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
                sock.settimeout(.5);sock.connect(str(self.slot/'mpv-socket'))
                sock.sendall((json.dumps({'command':command,'request_id':123})+'\n').encode())
                buf=b''
                while True:
                    buf+=sock.recv(4096)
                    while b'\n' in buf:
                        line,buf=buf.split(b'\n',1)
                        result=json.loads(line)
                        if result.get('request_id')==123:return result
        except (OSError,ValueError): return {}

    def prop(self,name):return self.command(['get_property',name]).get('data')
    def session(self):return json.loads((self.slot/'session.json').read_text())
    def until(self,predicate,seconds=8):
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            if predicate():return
            time.sleep(.03)
        self.log.flush() if hasattr(self,'log') else None
        self.fail('Timed out: '+(self.base/'mpv.log').read_text())

    def test_natural_completion_stops_without_fallback(self):
        self.start();self.proc.wait(timeout=8)
        self.assertEqual(self.session()['reason'],'natural_end')
        self.assertEqual(self.session()['phase'],'ended')

    def test_next_then_next_loads_real_fallback_and_keeps_deadline(self):
        self.start()
        self.command(['script-message','hub-next']);self.until(lambda:self.prop('playlist-pos')==1)
        self.command(['script-message','hub-next'])
        self.until(lambda: str(self.prop('path')).endswith('fallback1.wav'))
        self.assertEqual(self.session()['phase'],'fallback')
        self.assertEqual(self.session()['deadline'],self.state['deadline'])
        self.assertEqual(self.prop('loop-playlist'),'inf')
        self.until(lambda: self.prop('pause') is False)
        time.sleep(4.2)
        self.assertIsNone(self.proc.poll())
        self.assertEqual(self.session()['phase'],'fallback')

    def test_next_from_naturally_reached_second_track(self):
        self.start();self.until(lambda:self.prop('playlist-pos')==1)
        self.command(['script-message','hub-next'])
        self.until(lambda:str(self.prop('path')).endswith('fallback1.wav'))
        self.assertEqual(self.session()['phase'],'fallback')

    def test_wall_clock_cutoff_works_while_paused(self):
        self.start(seconds=2)
        self.command(['set_property','pause',True])
        self.proc.wait(timeout=5)
        self.assertEqual(self.session()['reason'],'max_duration')

    def test_stale_player_quits(self):
        self.start()
        data=self.session();data['session_id']='replacement'
        (self.slot/'session.json').write_text(json.dumps(data))
        self.proc.wait(timeout=4)

if __name__=='__main__':
    if not shutil.which('mpv'):raise SystemExit('mpv is required for these runtime checks')
    unittest.main(verbosity=2)
