#!/usr/bin/env python3
"""Bounded identity verification and non-forced cleanup of the exact run-1 root."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

REPO = Path.cwd().resolve()
TARGET = Path('/private/tmp/qf-e48de0bc.20261031T112739Z')
WORKTREE = TARGET / 'worktree'
CAPTURE = Path('/private/tmp/qf-e48de0bc.20261031T141753Z.CGuW0B/capture')
ARCHIVE = REPO / 'docs/evidence/member-activity-e48de0bc/20261031T112739Z'
EXPECTED_SHA = 'e48de0bc22a28d41203d653fb1bedf8a2ecf071a'
EXPECTED_TOP = {'capture', 'deps', 'home', 'npm-cache', 'npm-logs', 'pg', 'stop-report.md', 'worktree'}
steps: list[dict[str, object]] = []


def fail(gate: str, detail: object) -> None:
    steps.append({'gate': gate, 'result': 'stop', 'detail': detail})
    write_report()
    raise SystemExit(70)


def write_report() -> None:
    (CAPTURE / 'cleanup-root1-summary.json').write_text(
        json.dumps({'target': str(TARGET), 'steps': steps}, indent=2) + '\n'
    )


def check(gate: str, passed: bool, detail: object) -> None:
    steps.append({'gate': gate, 'result': 'pass' if passed else 'stop', 'detail': detail})
    write_report()
    if not passed:
        raise SystemExit(70)


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def archived_hashes() -> set[str]:
    return {sha(p) for p in ARCHIVE.rglob('*') if p.is_file() and not p.is_symlink()}


def unarchived_files(root: Path, hashes: set[str]) -> list[str]:
    result: list[str] = []
    for p in root.rglob('*'):
        if WORKTREE in p.parents or p == WORKTREE:
            continue
        if p.is_symlink():
            result.append(p.relative_to(root).as_posix() + ' [symlink]')
        elif p.is_file() and sha(p) not in hashes:
            result.append(p.relative_to(root).as_posix())
    return result


def worktree_blocks() -> list[str]:
    p = subprocess.run(['git', '-C', str(REPO), 'worktree', 'list', '--porcelain'],
                       text=True, capture_output=True)
    if p.returncode != 0:
        fail('A.e.worktree-list-command', {'exit': p.returncode, 'stderr_bytes': len(p.stderr)})
    # Emit and retain only the exact /private/tmp target stanza; other local paths stay private.
    blocks = [b for b in p.stdout.strip().split('\n\n') if b.splitlines() and b.splitlines()[0] == f'worktree {WORKTREE}']
    return blocks


def no_occupancy(label: str, args: list[str]) -> None:
    p = subprocess.run(args, text=True, capture_output=True)
    # Preserve potentially sensitive raw output outside the target; only publish counts and hash.
    raw = (p.stdout + p.stderr).encode()
    (CAPTURE / f'{label}.raw').write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    check(label, p.returncode == 1 and len(raw) == 0,
          {'exit': p.returncode, 'output_bytes': len(raw), 'output_sha256': digest})


def main() -> None:
    check('A.a.path-and-symlink', TARGET.exists() and TARGET.is_dir() and not TARGET.is_symlink()
          and TARGET.resolve() == TARGET,
          {'exists': TARGET.exists(), 'symlink': TARGET.is_symlink(), 'realpath': str(TARGET.resolve()) if TARGET.exists() else None})

    top = {p.name for p in TARGET.iterdir()}
    check('A.b.top-level', top == EXPECTED_TOP,
          {'observed': sorted(top), 'matches_archived_manifest': top == EXPECTED_TOP})

    git_file = WORKTREE / '.git'
    pointer = git_file.read_text().strip() if git_file.is_file() else ''
    prefix = 'gitdir: '
    raw_target = pointer[len(prefix):] if pointer.startswith(prefix) else ''
    admin = Path(raw_target)
    if raw_target and not admin.is_absolute():
        admin = (WORKTREE / admin).resolve()
    admin = admin.resolve() if raw_target else Path('/nonexistent')
    common = (REPO / '.git' / 'worktrees').resolve()
    pointer_suffix = None
    try:
        pointer_suffix = admin.relative_to(REPO).as_posix()
    except ValueError:
        pass
    backref = (admin / 'gitdir').read_text().strip() if (admin / 'gitdir').is_file() else ''
    backref_target = Path(backref)
    if backref and not backref_target.is_absolute():
        backref_target = (admin / backref_target).resolve()
    commondir = (admin / 'commondir').read_text().strip() if (admin / 'commondir').is_file() else ''
    common_target = Path(commondir)
    if commondir and not common_target.is_absolute():
        common_target = (admin / common_target).resolve()
    try:
        admin.relative_to(common)
        under_common = True
    except ValueError:
        under_common = False
    pointer_hash = hashlib.sha256(pointer.encode()).hexdigest() if pointer else None
    check('A.c.git-pointer', bool(pointer) and under_common and admin.is_dir()
          and backref_target == git_file.resolve() and common_target == (REPO / '.git').resolve(),
          {'pointer_suffix': pointer_suffix, 'pointer_sha256': pointer_hash,
           'admin_exists': admin.is_dir(), 'under_main_worktrees': under_common,
           'backref_matches': backref_target == git_file.resolve(),
           'commondir_matches': common_target == (REPO / '.git').resolve()})

    head = subprocess.run(['git', '-C', str(WORKTREE), 'rev-parse', 'HEAD'], text=True, capture_output=True)
    check('A.c.fixed-head', head.returncode == 0 and head.stdout.strip() == EXPECTED_SHA,
          {'exit': head.returncode, 'head': head.stdout.strip()})
    status = subprocess.run(['git', '-C', str(WORKTREE), 'status', '--porcelain', '--ignored', '--untracked-files=all'],
                            text=True, capture_output=True)
    check('A.c.clean-worktree', status.returncode == 0 and status.stdout == '' and status.stderr == '',
          {'exit': status.returncode, 'status_lines': status.stdout.splitlines(), 'stderr_bytes': len(status.stderr)})

    hashes = archived_hashes()
    unique = unarchived_files(TARGET, hashes)
    check('A.d.no-unarchived-unique-files', unique == [], {'unique_files': unique})

    blocks = worktree_blocks()
    check('A.e.registered-worktree', len(blocks) == 1 and 'detached' in blocks[0].splitlines()
          and 'locked' not in blocks[0].splitlines(), {'matching_stanzas': blocks})

    no_occupancy('A.f.lsof-plus-D', ['lsof', '+D', str(TARGET)])
    no_occupancy('A.f.cwd-probe', ['lsof', '-a', '-d', 'cwd', '+D', str(TARGET)])

    remove = subprocess.run(['git', '-C', str(REPO), 'worktree', 'remove', str(WORKTREE)],
                            text=True, capture_output=True)
    (CAPTURE / 'worktree-remove.stdout').write_text(remove.stdout)
    (CAPTURE / 'worktree-remove.stderr').write_text(remove.stderr)
    check('cleanup.worktree-remove-no-force', remove.returncode == 0 and not WORKTREE.exists(),
          {'exit': remove.returncode, 'stdout': remove.stdout, 'stderr': remove.stderr,
           'worktree_absent': not WORKTREE.exists()})

    remaining_blocks = worktree_blocks()
    check('cleanup.worktree-unregistered', remaining_blocks == [], {'matching_stanzas': remaining_blocks})
    unique_after = unarchived_files(TARGET, hashes)
    check('cleanup.remaining-files-still-archived', unique_after == [], {'unique_files': unique_after})

    # Remove only files whose contents were proven present in the archived run evidence.
    files = [p for p in TARGET.rglob('*') if p.is_file()]
    for p in files:
        if p.is_symlink() or sha(p) not in hashes:
            fail('cleanup.changed-file-before-unlink', p.relative_to(TARGET).as_posix())
    for p in sorted(files, key=lambda x: len(x.parts), reverse=True):
        p.unlink()
    dirs = [p for p in TARGET.rglob('*') if p.is_dir()]
    for p in sorted(dirs, key=lambda x: len(x.parts), reverse=True):
        if p.is_symlink():
            fail('cleanup.symlink-before-rmdir', p.relative_to(TARGET).as_posix())
        p.rmdir()
    TARGET.rmdir()
    check('cleanup.exact-root-removed', not TARGET.exists(), {'target_absent': not TARGET.exists()})
    write_report()


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        fail('unexpected-error', type(e).__name__ + ': ' + str(e))
