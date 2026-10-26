# Independent network recovery

`network_guard.py` runs as a root system service, independently of the playback
process and its user services. Python's standard library, NetworkManager,
`iproute2`, and `ping` are required. It checks every 30 seconds after the prior
check finishes, beginning 45 seconds after boot.

A healthy check requires a global IPv4 address on the configured Wi-Fi interface,
a usable local IPv4 route, and a successful interface-bound IPv4 ping to either
the configured LAN probe or the interface's default gateway. The gateway is tried
when the LAN probe is unreachable. IPv6 connectivity alone does not count. Choose a
reliable, always-on LAN server or gateway that permits ICMP echo. Internet access,
DNS, and the playback application are not dependencies. A LAN server under maintenance does not trigger recovery if the default gateway
still responds. If both targets reject ICMP echo, recovery will trigger even
though some other traffic might work.

After three consecutive unhealthy checks, the guard disconnects Wi-Fi and brings
up the configured NetworkManager connection by UUID. Three failed reconnects
cause the next attempt to restart NetworkManager before reconnecting. Recovery
attempts are at least 180 seconds apart. A successful health check clears the
failure and reconnect counts; the most recent recovery time remains as a cooldown
if connectivity immediately fails again. This handles future DHCP lease loss and
recoverable NetworkManager/Wi-Fi failures without rebooting the host. It cannot
repair failed access points, power loss, hardware faults, or an unavailable LAN.

Every command has a timeout; even the escalation path has a 81-second maximum
command budget. The service has a 90-second timeout and kills its entire process
group. A file lock prevents concurrent recovery. Counters and cooldown persist in
`/var/lib/playback-hub-network-guard/state.json`, written atomically before any
network mutation. Missing or invalid configuration stops recovery and emits a journal event.
Corrupt state is quarantined and counters reset with a fresh cooldown; recovery
resumes after 180 seconds if connectivity is still unhealthy. Unchanged healthy
checks do not rewrite state or change networking.

## Install

Run from this directory on the hub (or copy the listed files to the hub first):

```sh
sudo install -d /usr/local/lib/playback-hub
sudo install -m 0644 network_guard.py /usr/local/lib/playback-hub/network_guard.py
sudo install -m 0644 contrib/systemd/playback-hub-network-guard.service /etc/systemd/system/
sudo install -m 0644 contrib/systemd/playback-hub-network-guard.timer /etc/systemd/system/
sudo install -m 0600 /dev/null /etc/default/playback-hub-network-guard
sudoedit /etc/default/playback-hub-network-guard
```

Set installation-specific values in that file; keep them out of the repository:

```sh
HUB_WIFI_INTERFACE=<wifi-interface>
HUB_CONNECTION_UUID=<NetworkManager-connection-uuid>
HUB_LAN_PROBE=<reliable-LAN-IPv4-address>
```

Find the interface with `nmcli device status` and connection UUID with
`nmcli -f NAME,UUID,DEVICE connection show`. Validate without mutating networking
or recovery state before enabling the timer:

```sh
sudo sh -c 'set -a; . /etc/default/playback-hub-network-guard; exec /usr/bin/python3 /usr/local/lib/playback-hub/network_guard.py --check-only'
sudo systemctl daemon-reload
sudo systemctl enable --now playback-hub-network-guard.timer
sudo systemctl status playback-hub-network-guard.timer
sudo journalctl -u playback-hub-network-guard.service -n 30 --no-pager
```

Check mode returns 0 for healthy, 1 for unhealthy, and 2 for configuration or
execution errors. The regular service also returns 1 while connectivity is
unhealthy; the timer continues scheduling after failures. Structured JSON events
use the `hub.network.*` prefix. To disable recovery, run
`sudo systemctl disable --now playback-hub-network-guard.timer`. Stopping the timer
does not interrupt an already running recovery; stop its service as well if
needed. NetworkManager restarts briefly affect all host interfaces.

`--state-dir` overrides the state location for isolated validation. Run unit tests
with `python3 -m unittest discover -s . -p 'test_network_guard.py'` from this directory.
