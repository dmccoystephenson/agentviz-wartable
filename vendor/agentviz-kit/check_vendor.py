"""Checks that a visualization's vendored agentviz copies match their PIN.

    python3 vendor/agentviz-kit/check_vendor.py          # from the viz repo root
    python3 kit/check_vendor.py --digest <dir>           # what vendor-kit.sh writes

tools/vendor-kit.sh writes vendor/agentfeed/PIN and vendor/agentviz-kit/PIN:
line 1 is the agentviz commit, line 2 "sha256:<digest>" of the copied files.
A copy edited by hand no longer matches its digest. The kit's page files are
also served from the repo's web/ (vendor-kit.sh copies them there), and those
copies must equal the vendored ones. Stdlib only, Python 3.8+.
"""
import hashlib
import os
import sys

VENDORED = ("agentfeed", "agentviz-kit")
SKIP_DIRS = {"__pycache__", "node_modules"}
SKIP_FILES = {"PIN"}


def digest(root):
    """sha256 over every file's relative path and bytes, in path order."""
    h = hashlib.sha256()
    paths = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in files:
            if name in SKIP_FILES or name.endswith(".pyc"):
                continue
            paths.append(os.path.relpath(os.path.join(folder, name), root).replace(os.sep, "/"))
    for rel in sorted(paths):
        h.update(rel.encode("utf-8") + b"\0")
        with open(os.path.join(root, rel), "rb") as f:
            h.update(f.read())
        h.update(b"\0")
    return h.hexdigest()


def pinned_digest(pin_path):
    with open(pin_path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("sha256:"):
                return line.strip()[len("sha256:"):]
    return None


def served_copy_problems(repo):
    """web/agentviz-*.js|css must be byte-identical to vendor/agentviz-kit/web/."""
    kit_web = os.path.join(repo, "vendor", "agentviz-kit", "web")
    web = os.path.join(repo, "web")
    if not (os.path.isdir(kit_web) and os.path.isdir(web)):
        return []
    found = []
    for name in sorted(os.listdir(kit_web)):
        served = os.path.join(web, name)
        if not os.path.isfile(served):
            found.append("web/%s is missing (re-vendor with tools/vendor-kit.sh)" % name)
            continue
        with open(served, "rb") as a, open(os.path.join(kit_web, name), "rb") as b:
            if a.read() != b.read():
                found.append("web/%s differs from vendor/agentviz-kit/web/%s (re-vendor)" % (name, name))
    return found


def problems(repo):
    """Human-readable mismatches for each vendored copy (empty when all match)."""
    found = []
    for name in VENDORED:
        root = os.path.join(repo, "vendor", name)
        pin = os.path.join(root, "PIN")
        if not os.path.isfile(pin):
            found.append("vendor/%s: no PIN (re-vendor with agentviz tools/vendor-kit.sh)" % name)
            continue
        want = pinned_digest(pin)
        if want is None:
            found.append("vendor/%s/PIN has no sha256 line (re-vendor)" % name)
        elif digest(root) != want:
            found.append("vendor/%s differs from its PIN: never edit vendored code, re-vendor" % name)
    return found + served_copy_problems(repo)


def main(argv):
    if len(argv) == 3 and argv[1] == "--digest":
        print(digest(argv[2]))
        return 0
    repo = argv[1] if len(argv) > 1 else os.getcwd()
    found = problems(repo)
    for line in found:
        print(line, file=sys.stderr)
    if not found:
        print("vendored agentfeed and agentviz-kit match their PINs")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
