"""Guard tests every visualization runs (from its own unittest suite):

    import importlib.util, os
    spec = importlib.util.spec_from_file_location(
        "guards", os.path.join(REPO, "vendor", "agentviz-kit", "tests", "guards.py"))
    guards = importlib.util.module_from_spec(spec); spec.loader.exec_module(guards)
    class Guards(guards.GuardTests):
        REPO = REPO

They keep three promises: feed strings reach the DOM as text only (no
innerHTML in the page's own scripts), no failure is swallowed (no empty catch
blocks), and no machine-local path is committed."""
import os
import re
import subprocess
import unittest

EMPTY_CATCH = re.compile(r"catch\s*(\([^)]*\))?\s*\{\s*\}")
MACHINE_PATHS = ("/" + "root/", "/" + "home/", "C:" + "\\\\Users\\\\")  # split so this file doesn't match itself
BINARY = (".wasm", ".png", ".gif", ".jpg", ".jpeg", ".webp", ".mp4", ".f32", "package-lock.json")
ALLOWED_PATH_FILES = ("CLAUDE.md",)  # the "while private" localci line, removed on flip day
# Paths in Emscripten's virtual filesystem, written into every built engine;
# they name no real machine.
EMSCRIPTEN_VIRTUAL_PATHS = ("/" + "home/web_user", "/" + "tmp/filedrop")


def own_page_files(repo):
    """The page's own scripts and HTML: web/ minus vendored kit and Strata files
    and built engines."""
    web = os.path.join(repo, "web")
    for name in sorted(os.listdir(web)):
        vendored = name.startswith(("agentviz-", "strata-")) or "-engine." in name
        if name.endswith((".js", ".html")) and not vendored:
            yield name, os.path.join(web, name)


def tracked_text_files(repo):
    out = subprocess.run(["git", "ls-files"], cwd=repo, stdout=subprocess.PIPE, universal_newlines=True).stdout
    for name in out.split():
        path = os.path.join(repo, name)
        if name.endswith(BINARY) or name.startswith("vendor/") or not os.path.isfile(path):
            continue
        yield name, path


def _read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


class GuardTests(unittest.TestCase):
    REPO = None  # set by the subclass in each repo

    def setUp(self):
        if not self.REPO:
            self.skipTest("GuardTests needs REPO")

    def test_no_innerHTML_in_page_files(self):
        for name, path in own_page_files(self.REPO):
            self.assertNotIn("innerHTML", _read(path), name)

    def test_no_empty_catch_in_page_scripts(self):
        for name, path in own_page_files(self.REPO):
            if name.endswith(".js"):
                self.assertIsNone(EMPTY_CATCH.search(_read(path)), name)

    def test_no_machine_paths_in_tracked_text(self):
        for name, path in tracked_text_files(self.REPO):
            if os.path.basename(name) in ALLOWED_PATH_FILES:
                continue
            text = _read(path)
            if "-engine." in os.path.basename(name):
                for virtual in EMSCRIPTEN_VIRTUAL_PATHS:
                    text = text.replace(virtual, "")
            for marker in MACHINE_PATHS:
                self.assertNotIn(marker, text, "%s contains %s" % (name, marker))
