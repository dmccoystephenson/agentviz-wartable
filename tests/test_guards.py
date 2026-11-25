"""The kit's guard tests: no innerHTML in the page's own files, no empty catch
blocks, no machine-local paths in tracked text."""
import importlib.util
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_spec = importlib.util.spec_from_file_location(
    "guards", os.path.join(REPO, "vendor", "agentviz-kit", "tests", "guards.py"))
guards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guards)

# Emscripten's virtual filesystem paths in the built engine, not machine paths (split so this file doesn't match).
ENGINE_VFS_PATHS = ("/" + "home/web_user", "/" + "tmp/filedrop")


class Guards(guards.GuardTests):
    REPO = REPO

    # This override can go at the next re-vendor (agentviz #10 fixes the kit guard).
    def test_no_machine_paths_in_tracked_text(self):
        for name, path in guards.tracked_text_files(self.REPO):
            if os.path.basename(name) in guards.ALLOWED_PATH_FILES:
                continue
            text = guards._read(path)
            if "-engine." in os.path.basename(name):
                for vfs in ENGINE_VFS_PATHS:
                    text = text.replace(vfs, "")
            for marker in guards.MACHINE_PATHS:
                self.assertNotIn(marker, text, "%s contains %s" % (name, marker))
