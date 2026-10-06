# Doorbell on a screen: PIP webhook or Show briefly

Two ways to put the doorbell camera on a screen coexist. Pick by the screen.

| Path | How it is triggered | Use it for |
|---|---|---|
| **PIP webhook** | `POST /api/v1/camera/doorbell/event` (`{ "event": "ring" }`) publishes on the screen's subscribed topic; the screen's own `subscriptions` YAML shows the camera as a PIP corner/panel and dismisses it | Screens that already carry a doorbell subscription (office). It needs no routine and no device command. |
| **Show briefly** | A routine loads `GET /api/v1/device/<id>/load?play=camera:doorbell` (add `brief=<seconds>`; `brief=0` takes the screen) | Screens with a playing programme that must come back (living-room TV). The programme is paused underneath and returns at its spot, with its queue. |

Do not wire both to the same screen. The Show briefly surface does not
register with the screen's overlay provider, so a PIP still fires while a brief
is up; it is merely covered (the brief sits at z-index 9990, the PIP near 1000)
and is still there, and still dismissing itself, when the brief closes. (The
PIP manager does hold back a `show` while the PIP itself is fullscreen, and
demotes a panel to a corner while a fullscreen overlay is up, but neither
applies to a brief.) The result is the camera twice, one behind the other, and
a PIP the person never saw being dismissed. A routine camera start is brief
by default (30 s); say `brief=0` to make it take the screen instead.

Show briefly is delivered to the screen as a command (never a page URL), so a
cold screen is loaded to its base page first and then receives the same command.
Behaviour and contracts: `docs/reference/media/media-app-technical.md` §4.11
and §6.7.
