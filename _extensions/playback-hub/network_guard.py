#!/usr/bin/env python3
"""Independent, bounded NetworkManager recovery for an IPv4 LAN playback hub."""
import argparse
from dataclasses import dataclass
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid


def logev(event, **data):
    print(json.dumps({'event': 'hub.network.' + event, 'ts': time.time(), **data}), flush=True)


@dataclass(frozen=True)
class Config:
    interface: str
    connection_uuid: str
    probe: str

    @classmethod
    def from_env(cls, env):
        interface = env.get('HUB_WIFI_INTERFACE', '')
        connection = env.get('HUB_CONNECTION_UUID', '')
        probe = env.get('HUB_LAN_PROBE', '')
        if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,15}', interface):
            raise ValueError('HUB_WIFI_INTERFACE must name a network interface')
        try:
            uuid.UUID(connection)
            address = ipaddress.IPv4Address(probe)
            if address.is_unspecified or address.is_multicast or address.is_loopback or address.is_link_local:
                raise ValueError('probe must be a usable LAN IPv4 address')
        except ValueError as exc:
            raise ValueError('HUB_CONNECTION_UUID and HUB_LAN_PROBE must be a UUID and LAN IPv4 address') from exc
        return cls(interface, connection, probe)


def run_command(argv, timeout):
    return subprocess.run(argv, timeout=timeout, capture_output=True, text=True, check=False)


class Guard:
    FAILURE_THRESHOLD = 3
    COOLDOWN = 180

    def __init__(self, config, state_dir, runner=run_command, clock=time.time, logger=logev):
        self.config = config
        self.state_dir = Path(state_dir)
        self.runner = runner
        self.clock = clock
        self.log = logger

    def command(self, argv, timeout):
        try:
            result = self.runner(argv, timeout=timeout)
            if result.returncode:
                self.log('command.failed', command=argv[0], status=result.returncode)
                return None
            return result.stdout
        except (OSError, subprocess.SubprocessError) as exc:
            self.log('command.error', command=argv[0], error=type(exc).__name__)
            return None

    def health(self):
        interface = self.config.interface
        raw = self.command(['ip', '-j', '-4', 'addr', 'show', 'dev', interface], 3)
        try:
            addresses = json.loads(raw) if raw is not None else []
            valid = any(a.get('family') == 'inet' and a.get('scope') == 'global'
                        and not ipaddress.IPv4Address(a['local']).is_link_local
                        for entry in addresses for a in entry.get('addr_info', []))
            if not valid:
                return False, 'missing_ipv4'
            raw = self.command(['ip', '-j', '-4', 'route', 'get', self.config.probe], 3)
            routes = json.loads(raw) if raw is not None else []
            routed = any(r.get('dev') == interface and r.get('type', 'unicast') == 'unicast' for r in routes)
            if routed and self.ping(self.config.probe):
                return True, 'healthy'
            # A LAN server can be offline while Wi-Fi is working. Confirm the
            # interface's local gateway before disrupting the connection.
            raw = self.command(['ip', '-j', '-4', 'route', 'show', 'default', 'dev', interface], 3)
            gateways = json.loads(raw) if raw is not None else []
            for route in gateways:
                gateway = route.get('gateway')
                if route.get('dev') == interface and gateway and str(ipaddress.IPv4Address(gateway)) != self.config.probe:
                    if self.ping(gateway):
                        return True, 'gateway_healthy'
                    break  # One gateway probe keeps the invocation budget bounded.
            return False, 'lan_probe_failed' if routed else 'missing_lan_route'
        except (ValueError, TypeError, KeyError, AttributeError):
            return False, 'invalid_network_response'

    def ping(self, target):
        return self.command(['ping', '-4', '-n', '-I', self.config.interface,
                             '-c', '1', '-W', '2', target], 3) is not None

    def load(self):
        path = self.state_dir / 'state.json'
        if not path.exists():
            return {'failures': 0, 'failed_recoveries': 0, 'last_recovery': 0}
        state = json.loads(path.read_text())
        for key in ('failures', 'failed_recoveries', 'last_recovery'):
            value = state[key]
            if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0 or not value < float('inf'):
                raise ValueError('invalid recovery state')
        return state

    def save(self, state):
        temporary = self.state_dir / 'state.json.tmp'
        with temporary.open('w') as handle:
            json.dump(state, handle)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(self.state_dir / 'state.json')

    def tick(self, check_only=False):
        if check_only:
            healthy, reason = self.health()
            self.log('check', healthy=healthy, reason=reason, check_only=True)
            return 0 if healthy else 1
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.state_dir / 'guard.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                self.log('already_running')
                return 0
            try:
                return self._tick()
            except (OSError, ValueError, KeyError, TypeError) as exc:
                self.log('state.error', error=type(exc).__name__)
                return 2

    def _tick(self):
        try:
            state = self.load()
        except (ValueError, KeyError, TypeError):
            quarantine = self.state_dir / ('state.corrupt.%s.json' % time.time_ns())
            (self.state_dir / 'state.json').replace(quarantine)
            state = {'failures': 0, 'failed_recoveries': 0, 'last_recovery': self.clock()}
            self.save(state)
            self.log('state.reset', quarantine=quarantine.name)
        healthy, reason = self.health()
        if healthy:
            if state['failures'] or state['failed_recoveries']:
                self.log('restored')
                state.update(failures=0, failed_recoveries=0)
                self.save(state)
            elif not (self.state_dir / 'state.json').exists():
                self.save(state)
            return 0
        state['failures'] += 1
        now = self.clock()
        elapsed = now - state['last_recovery']
        self.log('unhealthy', reason=reason, failures=state['failures'])
        if state['failures'] < self.FAILURE_THRESHOLD or (state['last_recovery'] and 0 <= elapsed < self.COOLDOWN):
            self.save(state)
            return 1
        # Persist BEFORE disrupting networking: a killed invocation still observes cooldown.
        escalate = state['failed_recoveries'] >= 3
        state['last_recovery'] = now
        state['failed_recoveries'] += 1
        self.save(state)
        self.log('recovery.start', escalation=escalate, attempt=state['failed_recoveries'])
        if escalate:
            self.command(['systemctl', 'restart', 'NetworkManager.service'], 15)
        self.command(['nmcli', '--wait', '5', 'device', 'disconnect', self.config.interface], 8)
        self.command(['nmcli', '--wait', '25', 'connection', 'up', 'uuid', self.config.connection_uuid,
                      'ifname', self.config.interface], 28)
        healthy, reason = self.health()
        if healthy:
            state.update(failures=0, failed_recoveries=0)
        self.save(state)
        self.log('recovery.result', healthy=healthy, reason=reason, escalation=escalate)
        return 0 if healthy else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true', help='Read network health without locking, state changes, or recovery')
    parser.add_argument('--state-dir', default='/var/lib/playback-hub-network-guard')
    args = parser.parse_args()
    try:
        config = Config.from_env(os.environ)
        return Guard(config, args.state_dir).tick(check_only=args.check_only)
    except (ValueError, OSError) as exc:
        logev('configuration.error', error=str(exc))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
