#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const logPath = path.join(repo, '.auto-push.log');
const lockPath = path.join(repo, '.auto-push.lock');
const pollMs = Number(process.env.AUTO_PUSH_POLL_MS || 3000);
const debounceMs = Number(process.env.AUTO_PUSH_DEBOUNCE_MS || 1200);

const ignoreDirs = new Set(['.git', 'node_modules', '.claude']);
const ignoreFiles = new Set(['.auto-push.log', '.auto-push.lock']);

let lastSnapshot = '';
let timer = null;
let busy = false;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`);
}

function git(args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function shouldIgnore(fullPath) {
  const relative = path.relative(repo, fullPath);
  if (!relative || relative.startsWith('..')) return true;
  const parts = relative.split(path.sep);
  if (parts.some((part) => ignoreDirs.has(part))) return true;
  return ignoreFiles.has(path.basename(fullPath)) || relative.endsWith('.log');
}

function walk(dir, entries) {
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    if (shouldIgnore(fullPath)) continue;
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(fullPath, entries);
    } else if (stat.isFile()) {
      entries.push(`${path.relative(repo, fullPath)}:${stat.mtimeMs}:${stat.size}`);
    }
  }
}

function snapshot() {
  const entries = [];
  walk(repo, entries);
  return entries.sort().join('\n');
}

function hasGitChanges() {
  return git(['status', '--porcelain']).length > 0;
}

function runPush() {
  if (busy || fs.existsSync(lockPath)) return;
  busy = true;
  fs.writeFileSync(lockPath, String(process.pid));
  try {
    if (!hasGitChanges()) return;
    git(['add', '-A']);
    if (!hasGitChanges()) return;
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    git(['commit', '-m', `自動保存 ${stamp}`]);
    git(['pull', '--rebase', 'origin', 'main']);
    git(['push', 'origin', 'main']);
    log('Pushed local changes to GitHub.');
  } catch (error) {
    log(`Stopped by auto-push error: ${error.stderr || error.message}`);
  } finally {
    try { fs.unlinkSync(lockPath); } catch {}
    busy = false;
  }
}

function schedulePush() {
  clearTimeout(timer);
  timer = setTimeout(runPush, debounceMs);
}

function tick() {
  let nextSnapshot;
  try {
    nextSnapshot = snapshot();
  } catch (error) {
    log(`Snapshot error: ${error.message}`);
    return;
  }
  if (lastSnapshot && nextSnapshot !== lastSnapshot) schedulePush();
  lastSnapshot = nextSnapshot;
}

process.on('SIGINT', () => {
  try { fs.unlinkSync(lockPath); } catch {}
  process.exit(0);
});

process.on('SIGTERM', () => {
  try { fs.unlinkSync(lockPath); } catch {}
  process.exit(0);
});

lastSnapshot = snapshot();
log(`Auto-push watcher started in ${repo}`);
setInterval(tick, pollMs);
