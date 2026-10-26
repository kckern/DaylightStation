"""Unattended recovery policy tests; no host network changes."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import network_guard as ng


class Network:
    def __init__(self):
        self.ipv4 = True
        self.route = True
        self.gateway = False
        self.gateway_ping = False
        self.ping = True
        self.repair = False
        self.commands = []
        self.error = None
        self.reconnect_status = 0

    def __call__(self, argv, timeout):
        self.commands.append((argv, timeout))
        if self.error:
            raise self.error
        output, code = '', 0
        if argv[:4] == ['ip', '-j', '-4', 'addr']:
            output = json.dumps([{'addr_info': [{'family': 'inet' if self.ipv4 else 'inet6', 'local': '192.0.2.2' if self.ipv4 else 'fe80::1', 'scope': 'global'}]}])
        elif argv[:4] == ['ip', '-j', '-4', 'route']:
            if 'default' in argv:
                output = json.dumps([{'dev': 'wlan-test', 'gateway': '192.0.2.254'}] if self.gateway else [])
            else:
                output = json.dumps([{'dev': 'wlan-test', 'prefsrc': '192.0.2.2'}] if self.route else [])
        elif argv[0] == 'ping':
            code = 0 if (self.gateway_ping if argv[-1] == '192.0.2.254' else self.ping) else 1
        elif argv[0] == 'nmcli' and 'up' in argv:
            code = self.reconnect_status
            if self.repair and code == 0:
                self.ipv4 = self.route = self.ping = True
        return subprocess.CompletedProcess(argv, code, output, '')


class NetworkGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.net = Network()
        self.clock = 1000
        self.config = ng.Config('wlan-test', '00000000-0000-0000-0000-000000000001', '192.0.2.1')
        self.guard = ng.Guard(self.config, self.path, runner=self.net, clock=lambda: self.clock, logger=lambda *a, **k: None)

    def state(self):
        return json.loads((self.path / 'state.json').read_text())

    def mutations(self):
        return [args for args, _ in self.net.commands if args[0] in ('nmcli', 'systemctl')]

    def fail_three(self):
        for _ in range(3):
            self.guard.tick()

    def test_healthy_is_read_only_for_network(self):
        self.assertEqual(self.guard.tick(), 0)
        self.assertEqual(self.mutations(), [])

    def test_ipv6_does_not_mask_lost_ipv4_and_threshold(self):
        self.net.ipv4 = False
        self.guard.tick()
        self.guard.tick()
        self.assertEqual(self.mutations(), [])
        self.guard.tick()
        self.assertIn(['nmcli', '--wait', '5', 'device', 'disconnect', 'wlan-test'], self.mutations())
        self.assertEqual(self.state()['failed_recoveries'], 1)

    def test_route_or_lan_probe_failure_is_unhealthy(self):
        self.net.route = False
        self.assertFalse(self.guard.health()[0])
        self.net.route = True
        self.net.ping = False
        self.assertFalse(self.guard.health()[0])

    def test_gateway_healthy_while_probe_down_prevents_disruption(self):
        self.net.ping = False
        self.net.gateway = self.net.gateway_ping = True
        self.fail_three()
        self.assertEqual(self.mutations(), [])
        self.assertEqual(self.state()['failures'], 0)

    def test_probe_and_gateway_both_down_trigger_recovery(self):
        self.net.ping = False
        self.net.gateway = True
        self.fail_three()
        self.assertEqual(len(self.mutations()), 2)

    def test_unchanged_healthy_state_is_not_rewritten(self):
        self.guard.tick()
        path = self.path / 'state.json'
        import os
        os.utime(path, ns=(1, 1))
        self.guard.tick()
        self.assertEqual(path.stat().st_mtime_ns, 1)

    def test_cooldown_prevents_churn(self):
        self.net.ping = False
        self.fail_three()
        actions = len(self.mutations())
        for _ in range(20):
            self.guard.tick()
        self.assertEqual(len(self.mutations()), actions)
        self.clock += 180
        self.guard.tick()
        self.assertEqual(len(self.mutations()), actions + 2)

    def test_escalation_after_three_failed_reconnects(self):
        self.net.ipv4 = False
        self.fail_three()
        for _ in range(2):
            self.clock += 180
            self.guard.tick()
        self.assertFalse(any(a[0] == 'systemctl' for a in self.mutations()))
        self.clock += 180
        self.guard.tick()
        self.assertIn(['systemctl', 'restart', 'NetworkManager.service'], self.mutations())

    def test_successful_recovery_resets_failures(self):
        self.net.ipv4 = False
        self.net.repair = True
        self.fail_three()
        self.assertEqual(self.state()['failures'], 0)
        self.assertEqual(self.state()['failed_recoveries'], 0)
        self.assertEqual(self.state()['last_recovery'], self.clock)

    def test_healthy_later_resets_failures_and_attempts(self):
        self.net.ping = False
        self.fail_three()
        self.net.ping = True
        self.guard.tick()
        self.assertEqual(self.state()['failures'], 0)
        self.assertEqual(self.state()['failed_recoveries'], 0)

    def test_command_timeouts_and_missing_binaries_are_handled(self):
        for error in (subprocess.TimeoutExpired('ip', 3), FileNotFoundError('ip')):
            self.net.error = error
            self.assertFalse(self.guard.health()[0])
        self.fail_three()
        self.assertEqual(self.state()['failed_recoveries'], 1)
        self.assertTrue(all(0 < timeout <= 30 for _, timeout in self.net.commands))

    def test_check_only_does_not_touch_existing_or_missing_state(self):
        self.net.ping = False
        self.assertEqual(self.guard.tick(check_only=True), 1)
        self.assertEqual(list(self.path.iterdir()), [])
        self.fail_three()
        before = (self.path / 'state.json').read_bytes()
        self.guard.tick(check_only=True)
        self.assertEqual((self.path / 'state.json').read_bytes(), before)
        self.assertEqual(len(self.mutations()), 2)

    def test_failed_connection_command_remains_retryable(self):
        self.net.ipv4 = False
        self.net.reconnect_status = 10
        self.fail_three()
        self.assertEqual(self.state()['failed_recoveries'], 1)
        self.clock += 180
        self.net.reconnect_status = 0
        self.net.repair = True
        self.assertEqual(self.guard.tick(), 0)
        self.assertEqual(self.state()['failed_recoveries'], 0)

    def test_invalid_config_is_rejected(self):
        for env in ({}, {'HUB_WIFI_INTERFACE': 'x', 'HUB_CONNECTION_UUID': 'not-uuid', 'HUB_LAN_PROBE': 'example.com'}):
            with self.assertRaises(ValueError):
                ng.Config.from_env(env)

    def test_lock_contention_never_runs_network_commands(self):
        import fcntl
        with (self.path / 'guard.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.guard.tick(), 0)
        self.assertEqual(self.net.commands, [])

    def test_corrupt_state_is_quarantined_and_recovers_after_cooldown(self):
        (self.path / 'state.json').write_text('{bad')
        self.net.ipv4 = False
        self.assertEqual(self.guard.tick(), 1)
        self.assertEqual(self.mutations(), [])
        self.assertEqual(len(list(self.path.glob('state.corrupt.*.json'))), 1)
        self.guard.tick()
        self.guard.tick()
        self.assertEqual(self.mutations(), [])
        self.clock += 180
        self.guard.tick()
        self.assertEqual(len(self.mutations()), 2)


if __name__ == '__main__':
    unittest.main()
