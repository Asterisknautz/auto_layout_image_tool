#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

function getCommandOutput(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const commit = getCommandOutput('git rev-parse --short HEAD');
const branch = getCommandOutput('git rev-parse --abbrev-ref HEAD');
const status = getCommandOutput('git status --short') || 'clean';
const timestamp = new Date().toISOString();

const info = {
  commit,
  branch,
  status,
  builtAt: timestamp,
};

const outputPath = resolve('public/build-info.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(info, null, 2));

console.log(`[build-info] commit=${commit} branch=${branch} status=${status} time=${timestamp}`);
