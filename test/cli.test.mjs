import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { auditRepository, parseArguments, renderMarkdown } from '../src/cli.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'src', 'cli.mjs');

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'agentready-doctor-'));
  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return root;
}

test('scores a repository with evidence in every category at 100', async (context) => {
  const root = await fixture({
    'AGENTS.md': '# Instructions\n\nRepository structure: `src/` and `test/`. You must run `npm test` and `npm run lint` before completion. Never edit generated files. Permission boundaries protect deploy paths.\n',
    'packages/api/AGENTS.md': '# API scope\nRun API tests after changes.\n',
    'package.json': JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint .' } }),
    'README.md': '# Example\n\nRun `npm test` and `npm run lint`.\n',
    '.gitignore': '.env*\n!.env.example\nnode_modules/\ndist/\ncoverage/\n',
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Write(deploy/**)'] } }),
    '.claude/hooks/check.sh': '#!/bin/sh\nexit 0\n',
    '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: npm test\n      - run: npm run lint\n',
    '.github/dependabot.yml': 'version: 2\nupdates: []\n'
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const report = await auditRepository(root);
  assert.equal(report.score, 100);
  assert.equal(report.maxScore, 100);
  assert.equal(report.rating, 'Ready');
  assert.equal(report.checks.every((item) => item.passed), true);
});

test('keeps sparse repository score bounded and explains limitations', async (context) => {
  const root = await fixture({ 'README.md': '# Empty fixture\n' });
  context.after(() => rm(root, { recursive: true, force: true }));

  const report = await auditRepository(root);
  assert.equal(report.score >= 0 && report.score <= 100, true);
  assert.equal(report.score, 4);
  assert.match(report.scope, /do not prove security/i);
  assert.match(renderMarkdown(report), /absence of secrets/i);
});

test('flags only bounded potentially sensitive filenames without reading their contents', async (context) => {
  const root = await fixture({
    '.env.production': 'not-read-by-the-check',
    'fixtures/sample.pem': 'allowed sample name',
    'README.md': '# Fixture\n'
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const report = await auditRepository(root);
  const filenameCheck = report.checks.find((item) => item.id === 'secrets.filenames');
  assert.equal(filenameCheck.passed, false);
  assert.match(filenameCheck.evidence, /\.env\.production/);
  assert.doesNotMatch(filenameCheck.evidence, /not-read-by-the-check/);
  assert.doesNotMatch(filenameCheck.evidence, /sample\.pem/);
});

test('CLI writes Markdown and JSON before returning threshold failure', async (context) => {
  const root = await fixture({ 'README.md': '# Fixture\n' });
  const output = await mkdtemp(path.join(tmpdir(), 'agentready-output-'));
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(output, { recursive: true, force: true })
  ]));
  const markdownPath = path.join(output, 'report.md');
  const jsonPath = path.join(output, 'report.json');

  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, root, '--markdown', markdownPath, '--json', jsonPath, '--fail-below', '100']),
    (error) => error.code === 1
  );

  const markdown = await readFile(markdownPath, 'utf8');
  const json = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.match(markdown, /Harden My Repo Doctor report/);
  assert.equal(json.score, 4);
});

test('CLI runs when invoked through an installed package symlink', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'agentready-bin-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const linkedCli = path.join(root, 'harden-my-repo');
  await symlink(cliPath, linkedCli);

  const { stdout } = await execFileAsync(linkedCli, ['--help']);
  assert.match(stdout, /Harden My Repo Doctor 1\.0\.1/);
  assert.match(stdout, /--fail-below/);
});

test('argument parser validates thresholds and optional outputs', () => {
  assert.deepEqual(parseArguments(['repo', '--no-json', '--fail-below', '70', '--quiet']), {
    target: 'repo',
    markdown: 'harden-my-repo-report.md',
    json: null,
    failBelow: 70,
    githubSummary: false,
    quiet: true,
    help: false
  });
  assert.throws(() => parseArguments(['--fail-below', '101']), /between 0 and 100/);
  assert.throws(() => parseArguments(['--unknown']), /Unknown option/);
});
