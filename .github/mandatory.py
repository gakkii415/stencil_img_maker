#!/usr/bin/env python3
"""Small, explicit mandatory checks. No dependencies or recursive version replacement."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

# Only these exact source locations are authoritative. Never infer versions from prose,
# URLs, storage keys, dependency versions, historical files, or arbitrary vN strings.
VERSION_TARGETS = [["index.html","<div class=\"app-version\">v","</div>"]]
MIGRATION_BASE = 'd6eb0af503fa73334d92627e0481ecc3771d6675'
MIGRATION_VERSION = 28


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.PIPE)


def locate(text, prefix, suffix):
    if prefix and text.count(prefix) != 1:
        raise ValueError('正式バージョンの指定箇所が欠落または重複しています。')
    start = text.index(prefix) + len(prefix)
    end = text.find(suffix, start) if suffix else len(text)
    if end < 0 or not re.fullmatch(r'[1-9][0-9]*', text[start:end]):
        raise ValueError('正式バージョンは vN（正の整数）にしてください。')
    return start, end, int(text[start:end])


def version_task(base, fix):
    if not VERSION_TARGETS:
        raise ValueError('正式バージョンの正本が未設定です。VERSION_TARGETSを明示してください。')
    current = {p: Path(p).read_text(encoding='utf-8') for p, _, _ in VERSION_TARGETS}
    previous = {}
    for p in current:
        previous[p] = git('show', f'{base}:{p}').decode('utf-8')
    def normalized(text, path):
        spans = [locate(text, a, b) for p, a, b in VERSION_TARGETS if p == path]
        for start, end, _ in sorted(spans, reverse=True):
            text = text[:start] + '<VERSION>' + text[end:]
        return text
    if base == MIGRATION_BASE:
        expected = MIGRATION_VERSION
    else:
        numbers = {locate(previous[p], a, b)[2] for p, a, b in VERSION_TARGETS}
        if len(numbers) != 1:
            raise ValueError('作業開始時の正式バージョンが不一致です。正本を確認してください。')
        names = set(git('diff', '--name-only', '-z', base, '--').split(b'\0'))
        names.update(git('ls-files', '--others', '--exclude-standard', '-z').split(b'\0'))
        changed = any(n.decode() not in current or
                      normalized(previous[n.decode()], n.decode()) != normalized(current[n.decode()], n.decode())
                      for n in names if n)
        expected = numbers.pop() + int(changed)
    for p, a, b in VERSION_TARGETS:
        start, end, actual = locate(current[p], a, b)
        if fix and actual != expected:
            current[p] = current[p][:start] + str(expected) + current[p][end:]
            Path(p).write_text(current[p], encoding='utf-8')
        elif actual != expected:
            raise ValueError(f'{p}: v{actual} → v{expected} が必要。同じ --base で --fix を実行してください。')
    print(f'VERSION=v{expected}')


# Add checks here. Do not remove or weaken checks just to make a failing task pass.
TASKS = [('display-version', version_task)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='作業開始前の40文字SHA。再試行でも変更しない。')
    parser.add_argument('--fix', action='store_true')
    args = parser.parse_args()
    try:
        if not re.fullmatch(r'[0-9a-fA-F]{40}', args.base):
            raise ValueError('--baseには完全なコミットSHAが必要です。')
        os.chdir(git('rev-parse', '--show-toplevel').decode().strip())
        git('cat-file', '-e', args.base + '^{commit}')
        git('merge-base', '--is-ancestor', args.base, 'HEAD')
        if not TASKS or len({name for name, _ in TASKS}) != len(TASKS):
            raise ValueError('必須作業が空または重複しています。')
    except Exception as error:
        print(f'ERROR [base]: {error}', file=sys.stderr)
        return 1
    failed = False
    for name, task in TASKS:
        try:
            task(args.base, args.fix)
            print(f'PASS [{name}]')
        except Exception as error:
            failed = True
            print(f'ERROR [{name}]: {error}', file=sys.stderr)
    if failed:
        print('未完了。原因を直して同じ --base で再検査してください。', file=sys.stderr)
        return 1
    print('ローカル必須検査合格。既存テスト・公開反映・共有・チャット報告はAGENTS.mdに従って別途確認。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
