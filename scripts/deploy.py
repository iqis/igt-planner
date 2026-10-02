"""Ship the planner: build, smoke, deploy -- and for a release, tag it.

    py scripts/deploy.py dev     # any time: build dist-dev/ (experimental on), smoke it, deploy to igt-dev.iqis.app
    py scripts/deploy.py prod    # a release: needs a clean main, a VERSION not yet tagged and a CHANGELOG
                                 # entry for it; smokes the repo and dist/, deploys igt.iqis.app, tags
                                 # vVERSION and pushes main + the tag

Bump VERSION (and write its CHANGELOG entry) BEFORE `prod`: the version is part of the release
commit, so the About modal of what ships says the number it is tagged with.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(cmd, env=None, capture=False):
    exe = shutil.which(cmd[0]) or cmd[0]          # npm / npx are .cmd shims on Windows
    print("$", " ".join(cmd), flush=True)
    r = subprocess.run([exe, *cmd[1:]], cwd=ROOT, env=env, text=True, capture_output=capture)
    if r.returncode:
        if capture:
            print(r.stdout, r.stderr)
        raise SystemExit(f"failed: {' '.join(cmd)}")
    return r.stdout if capture else None


def git(*args):
    return run(["git", *args], capture=True).strip()


def smoke(root=None):
    env = dict(os.environ)
    if root:
        env["SMOKE_ROOT"] = root
    run(["npm", "run", "smoke"], env=env)


def main():
    channel = sys.argv[1] if len(sys.argv) > 1 else ""
    if channel not in ("dev", "prod"):
        raise SystemExit(__doc__)
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()

    if channel == "dev":
        run([sys.executable, "scripts/build_public.py", "dev"])
        smoke("dist-dev")
        run(["npx", "wrangler", "deploy", "--env", "dev"])
        print(f"\ndev is up: https://igt-dev.iqis.app  (v{version}+dev · {git('rev-parse', '--short', 'HEAD')})")
        return

    # ---- a release: refuse anything that would make the tag lie
    if git("status", "--porcelain"):
        raise SystemExit("working tree not clean -- commit first; a release is a commit")
    if git("rev-parse", "--abbrev-ref", "HEAD") != "main":
        raise SystemExit("releases go out from main")
    tag = f"v{version}"
    if git("tag", "-l", tag):
        raise SystemExit(f"{tag} is already released -- bump VERSION (and the CHANGELOG) first")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    if f"## [{version}]" not in changelog:
        raise SystemExit(f"CHANGELOG.md has no '## [{version}]' entry")

    smoke()
    run([sys.executable, "scripts/build_public.py", "prod"])
    smoke("dist")
    run(["npx", "wrangler", "deploy"])
    run(["git", "tag", "-a", tag, "-m", f"Siqi's IGT Planner {tag}"])
    env = {k: v for k, v in os.environ.items() if k != "GH_TOKEN"}   # push with the stored credential
    run(["git", "push", "origin", "main", tag], env=env)
    print(f"\nreleased {tag}: https://igt.iqis.app")


if __name__ == "__main__":
    main()
