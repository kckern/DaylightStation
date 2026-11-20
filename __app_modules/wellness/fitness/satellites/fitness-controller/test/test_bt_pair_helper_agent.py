"""The pairing agent's D-Bus signatures must match BlueZ's Agent1 API exactly:
a wrong signature fails at pairing time with no useful error."""
import importlib
import os
import sys
import types
import unittest
from unittest import mock

SRC = os.path.join(os.path.dirname(__file__), "..", "src")


def _stubs():
    dbus = types.ModuleType("dbus")
    dbus.UInt32 = int
    dbus.Boolean = bool

    class DBusException(Exception):
        pass

    dbus.DBusException = DBusException
    service = types.ModuleType("dbus.service")

    class Object:
        def __init__(self, *args, **kwargs):
            pass

    def method(interface, in_signature="", out_signature=""):
        def deco(fn):
            # Same attribute names the real dbus.service.method sets.
            fn._dbus_interface = interface
            fn._dbus_in_signature = in_signature
            fn._dbus_out_signature = out_signature
            return fn
        return deco

    service.Object = Object
    service.method = method
    dbus.service = service
    mainloop = types.ModuleType("dbus.mainloop")
    glib = types.ModuleType("dbus.mainloop.glib")
    mainloop.glib = glib
    dbus.mainloop = mainloop
    gi = types.ModuleType("gi")
    repo = types.ModuleType("gi.repository")
    repo.GLib = types.SimpleNamespace()
    gi.repository = repo
    return {"dbus": dbus, "dbus.service": service, "dbus.mainloop": mainloop,
            "dbus.mainloop.glib": glib, "gi": gi, "gi.repository": repo}


def load_helper():
    sys.path.insert(0, SRC)
    try:
        with mock.patch.dict(sys.modules, _stubs()):
            sys.modules.pop("bt_pair_helper", None)
            return importlib.import_module("bt_pair_helper")
    finally:
        sys.path.remove(SRC)


helper = load_helper()


def sig(fn):
    return (fn._dbus_interface, fn._dbus_in_signature, fn._dbus_out_signature)


class AgentSignatures(unittest.TestCase):
    def test_methods_match_bluez_agent1(self):
        A = helper.Agent
        self.assertEqual(sig(A.RequestPinCode), ("org.bluez.Agent1", "o", "s"))
        self.assertEqual(sig(A.RequestPasskey), ("org.bluez.Agent1", "o", "u"))
        self.assertEqual(sig(A.DisplayPasskey), ("org.bluez.Agent1", "ouq", ""))
        self.assertEqual(sig(A.DisplayPinCode), ("org.bluez.Agent1", "os", ""))
        self.assertEqual(sig(A.RequestConfirmation), ("org.bluez.Agent1", "ou", ""))
        self.assertEqual(sig(A.AuthorizeService), ("org.bluez.Agent1", "os", ""))

    def test_display_methods_report_the_code_to_type(self):
        seen = []
        agent = helper.Agent(None, "/agent", lambda path: "0000",
                             lambda path, kind, passkey, entered: seen.append((path, kind, passkey, entered)))
        agent.DisplayPasskey("/org/bluez/hci0/dev_AA", 4321, 2)
        agent.DisplayPinCode("/org/bluez/hci0/dev_AA", "012345")
        self.assertEqual(seen, [("/org/bluez/hci0/dev_AA", "passkey", "004321", 2),
                                ("/org/bluez/hci0/dev_AA", "pincode", "012345", 0)])


if __name__ == "__main__":
    unittest.main()
