"""The kit's guard tests: no innerHTML in the page's own files, no empty catch
blocks, no machine-local paths in tracked text."""
import importlib.util
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_spec = importlib.util.spec_from_file_location(
    "guards", os.path.join(REPO, "vendor", "agentviz-kit", "tests", "guards.py"))
guards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guards)


class Guards(guards.GuardTests):
    REPO = REPO
