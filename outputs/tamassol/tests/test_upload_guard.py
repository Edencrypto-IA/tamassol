"""Exercise the upload gate without running PlatformIO or accessing a device."""
import runpy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class FakeEnv:
    def __init__(self, confirmed="no", variant="UNVERIFIED", port=""):
        self.values = {"custom_hardware_confirmed": confirmed,
                       "custom_confirmed_variant": variant}
        self.port = port

    def GetProjectOption(self, name, default):
        return self.values.get(name, default)

    def subst(self, _):
        return self.port


def run_gate(target, env):
    script = types.ModuleType("SCons.Script")
    script.COMMAND_LINE_TARGETS = [target]
    modules = {"SCons": types.ModuleType("SCons"), "SCons.Script": script}
    with patch.dict(sys.modules, modules):
        runpy.run_path(str(Path(__file__).resolve().parents[1] / "tools/upload_guard.py"),
                       init_globals={"env": env, "Import": lambda _: None})


class UploadGuardTests(unittest.TestCase):
    def test_unconfirmed_build_is_allowed(self):
        run_gate("buildprog", FakeEnv())

    def test_every_write_target_is_blocked_unconfirmed(self):
        for target in ("upload", "uploadfs", "uploadfsota", "erase"):
            with self.subTest(target=target), self.assertRaises(RuntimeError):
                run_gate(target, FakeEnv())

    def test_variant_and_explicit_port_required(self):
        for variant, port in (("UNKNOWN", "COM3"), ("FNK0104B", ""),
                              ("FNK0104A", "COM*"), ("FNK0104B", "COM?")):
            with self.subTest(variant=variant, port=port), self.assertRaises(RuntimeError):
                run_gate("upload", FakeEnv("yes", variant, port))

    def test_confirmed_profile_with_explicit_port_is_allowed(self):
        for variant in ("FNK0104A", "FNK0104B"):
            run_gate("upload", FakeEnv("yes", variant, "COM3"))


if __name__ == "__main__":
    unittest.main()
