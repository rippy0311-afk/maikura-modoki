#!/usr/bin/env python3
"""直近の main への変更をまとめて Discord に投稿する。

GitHub Actions から呼ばれるが、ローカルでも動く:

    HOURS=168 DRY_RUN=true python3 scripts/discord_report.py

環境変数:
    DISCORD_WEBHOOK_URL  投稿先。DRY_RUN=true のときは不要
    HOURS                さかのぼる時間数 (既定 24)
    DRY_RUN              true なら送信せず内容を表示する
    REPO_URL             コミットへのリンクに使う (既定は origin から推定)
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

MAX_COMMITS = 20          # 一覧に載せる上限
MAX_DESCRIPTION = 4000    # Discord の embed description は 4096 文字まで
JST = timezone(timedelta(hours=9))

# urllib の既定 User-Agent (Python-urllib/3.x) は Discord の前段の Cloudflare に
# 弾かれる (HTTP 403 / error code 1010)。素性の分かる UA を必ず送る。
USER_AGENT = 'maikura-modoki-report/1.0 (+https://github.com/rippy0311-afk/maikura-modoki)'


def git(*args):
    result = subprocess.run(['git', *args], capture_output=True, text=True, check=True)
    return result.stdout


def guess_repo_url():
    try:
        remote = git('remote', 'get-url', 'origin').strip()
    except subprocess.CalledProcessError:
        return ''
    if remote.startswith('git@github.com:'):
        remote = 'https://github.com/' + remote[len('git@github.com:'):]
    return remote[:-4] if remote.endswith('.git') else remote


def collect(since):
    """(hash, author, subject) の一覧と、変更ファイルの出現回数を返す。"""
    sep = '\x1f'
    raw = git('log', f'--since={since}', f'--format=%h{sep}%an{sep}%s')
    commits = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split(sep)
        if len(parts) == 3:
            commits.append(tuple(parts))

    files = git('log', f'--since={since}', '--name-only', '--pretty=format:')
    counts = Counter(p for p in (l.strip() for l in files.splitlines()) if p)
    return commits, counts


def build_description(commits, counts, repo_url):
    authors = sorted({author for _, author, _ in commits})
    lines = [
        f'**{len(commits)}件のコミット** / 変更ファイル {len(counts)}件',
        f'作業者: {"、".join(authors)}',
        '',
    ]

    for sha, author, subject in commits[:MAX_COMMITS]:
        link = f'{repo_url}/commit/{sha}' if repo_url else ''
        label = f'[`{sha}`]({link})' if link else f'`{sha}`'
        lines.append(f'• {label} {subject} — {author}')

    if len(commits) > MAX_COMMITS:
        lines.append(f'…ほか {len(commits) - MAX_COMMITS} 件')

    top = counts.most_common(5)
    if top:
        lines += ['', '**よく触られたファイル**']
        lines += [f'• {path} ({n}回)' for path, n in top]

    text = '\n'.join(lines)
    if len(text) > MAX_DESCRIPTION:
        text = text[:MAX_DESCRIPTION - 10] + '\n…(省略)'
    return text


def main():
    hours = int(os.environ.get('HOURS') or 24)
    dry_run = (os.environ.get('DRY_RUN') or 'false').lower() == 'true'
    webhook = os.environ.get('DISCORD_WEBHOOK_URL') or ''
    repo_url = (os.environ.get('REPO_URL') or guess_repo_url()).rstrip('/')

    if not webhook and not dry_run:
        print('DISCORD_WEBHOOK_URL is not set', file=sys.stderr)
        return 1

    commits, counts = collect(f'{hours} hours ago')
    if not commits:
        print(f'No commits in the last {hours}h. Nothing to post.')
        return 0

    payload = {
        'username': 'maikura-modoki',
        'embeds': [{
            'title': f'{datetime.now(JST):%Y-%m-%d} のアップデート',
            'url': f'{repo_url}/commits/main' if repo_url else None,
            'description': build_description(commits, counts, repo_url),
            'color': 0x32A0FF,
        }],
    }
    payload['embeds'][0] = {k: v for k, v in payload['embeds'][0].items() if v is not None}

    if dry_run:
        print(payload['embeds'][0]['title'])
        print(payload['embeds'][0]['description'])
        return 0

    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        webhook, data=body, method='POST',
        headers={'Content-Type': 'application/json', 'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request) as response:
            print(f'Posted {len(commits)} commits to Discord (HTTP {response.status}).')
    except urllib.error.HTTPError as err:
        print(f'Discord rejected the post: HTTP {err.code} {err.read().decode()}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
