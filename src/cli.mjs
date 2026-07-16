#!/usr/bin/env node

import { appendFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_VERSION = '1.0.1';
const RESOURCE_URL = 'https://hardenmyrepo.com/free-ai-repo-audit';
const MAX_FILES = 10_000;
const MAX_TEXT_BYTES = 512 * 1024;
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.cache', '.next', '.nuxt', '.venv',
  'build', 'coverage', 'dist', 'node_modules', 'target', 'vendor', 'venv'
]);

const CATEGORY_MAX = {
  'Agent instructions': 20,
  'Verification commands': 20,
  'Agent settings and hooks': 15,
  'Secret hygiene signals': 15,
  'Context scope': 15,
  'Continuous integration': 15
};

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function check(id, category, label, maxPoints, passed, evidence, recommendation) {
  return {
    id,
    category,
    label,
    passed: Boolean(passed),
    points: passed ? maxPoints : 0,
    maxPoints,
    evidence,
    recommendation
  };
}

async function inventory(root) {
  const files = [];
  let truncated = false;

  async function visit(directory, prefix = '') {
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;

      const relative = normalize(path.join(prefix, entry.name));
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(absolute, relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  await visit(root);
  return { files, truncated };
}

async function readText(root, relativePath) {
  try {
    const absolute = path.join(root, relativePath);
    const metadata = await stat(absolute);
    if (!metadata.isFile() || metadata.size > MAX_TEXT_BYTES) return '';
    const contents = await readFile(absolute);
    if (contents.includes(0)) return '';
    return contents.toString('utf8');
  } catch {
    return '';
  }
}

async function readCombined(root, files) {
  const contents = await Promise.all(files.map((file) => readText(root, file)));
  return contents.join('\n');
}

function scriptsFromPackageJson(text) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed.scripts === 'object' && parsed.scripts ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function hasUsefulScript(scripts, matcher) {
  return Object.entries(scripts).some(([name, command]) => {
    if (!matcher.test(name) || typeof command !== 'string') return false;
    return !/no test specified|not implemented|todo/i.test(command);
  });
}

function matchingScriptNames(scripts, matcher) {
  return Object.keys(scripts).filter((name) => matcher.test(name));
}

function ignoresEnv(gitignore) {
  return gitignore.split(/\r?\n/).some((line) => {
    const value = line.trim();
    if (!value || value.startsWith('#') || value.startsWith('!')) return false;
    return /(^|\/)\.?env(?:\.\*|\*|$)|(^|\/)\.env(?:\..*)?$/.test(value);
  });
}

function ignoresGeneratedDirectories(ignoreText) {
  return ignoreText.split(/\r?\n/).some((line) => {
    const value = line.trim();
    return value && !value.startsWith('#') && /(?:node_modules|dist|build|coverage|\.next|target|vendor)/.test(value);
  });
}

function potentiallySensitiveFiles(files) {
  return files.filter((file) => {
    const base = path.posix.basename(file).toLowerCase();
    if (/(?:example|sample|template|fixture)/.test(base)) return false;
    return base === '.env'
      || /^\.env\.(?:local|production|prod|staging|development|dev)$/.test(base)
      || /^(?:id_rsa|id_ed25519)$/.test(base)
      || /(?:service[-_.]?account|credentials?)\.json$/.test(base)
      || /\.(?:key|p12|pfx|pem)$/.test(base);
  });
}

function displayTarget(root) {
  const relative = path.relative(process.cwd(), root);
  if (!relative) return '.';
  return relative.startsWith('..') ? path.basename(root) : normalize(relative);
}

export async function auditRepository(target = '.') {
  const root = path.resolve(target);
  let metadata;
  try {
    metadata = await stat(root);
  } catch {
    throw new Error(`Target does not exist: ${target}`);
  }
  if (!metadata.isDirectory()) throw new Error(`Target is not a directory: ${target}`);

  const { files, truncated } = await inventory(root);
  const fileSet = new Set(files);
  const rootGuides = ['AGENTS.md', 'CLAUDE.md'].filter((file) => fileSet.has(file));
  const allGuides = files.filter((file) => /(^|\/)(?:AGENTS|CLAUDE)\.md$/i.test(file));
  const nestedGuides = allGuides.filter((file) => file.includes('/'));
  const guideText = await readCombined(root, rootGuides);
  const guideSizes = await Promise.all(rootGuides.map(async (file) => ({ file, size: (await stat(path.join(root, file))).size })));

  const packageText = await readText(root, 'package.json');
  const scripts = scriptsFromPackageJson(packageText);
  const makeText = await readText(root, 'Makefile');
  const pyprojectText = await readText(root, 'pyproject.toml');
  const readmeFiles = files.filter((file) => /(^|\/)README(?:\.[^/]+)?\.md$|^README\.md$/i.test(file)).slice(0, 20);
  const documentationText = await readCombined(root, [...readmeFiles, ...rootGuides]);

  const testScriptNames = matchingScriptNames(scripts, /^(?:test|test:.*)$/i);
  const qualityScriptNames = matchingScriptNames(scripts, /^(?:lint|lint:.*|typecheck|type-check|check|build)$/i);
  const hasTestCommand = hasUsefulScript(scripts, /^(?:test|test:.*)$/i)
    || /^test\s*:/m.test(makeText)
    || /\bpytest\b|\[tool\.pytest/i.test(pyprojectText);
  const hasQualityCommand = hasUsefulScript(scripts, /^(?:lint|lint:.*|typecheck|type-check|check|build)$/i)
    || /^(?:lint|check|build|typecheck)\s*:/m.test(makeText)
    || /\b(?:ruff|mypy|pyright|black)\b/i.test(pyprojectText);
  const docsTestCommand = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bdotnet test\b|\bmake test\b/i.test(documentationText);
  const docsQualityCommand = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|typecheck|type-check|build|check)\b|\b(?:ruff|mypy|pyright|golangci-lint|cargo clippy)\b|\bmake (?:lint|check|build)\b/i.test(documentationText);

  const settingsFiles = files.filter((file) => /(^|\/)(?:\.claude\/settings(?:\.local)?\.json|\.cursor\/rules(?:\/|$)|\.github\/copilot-instructions\.md|\.agents\/config|\.codex\/config)/i.test(file));
  const reusableAutomationFiles = files.filter((file) => /(^|\/)(?:\.claude\/(?:hooks|commands|skills|agents)|\.agents\/(?:skills|agents)|\.codex\/skills|\.github\/skills|hooks)\//i.test(file));
  const settingsText = await readCombined(root, settingsFiles.slice(0, 30));
  const permissionsText = `${guideText}\n${settingsText}`;
  const hasPermissionBoundaries = /\b(?:permission|allowed tools?|denied tools?|deny|sandbox|read[- ]only|protected paths?|guardrail)\b|"(?:allow|deny|permissions)"\s*:/i.test(permissionsText);

  const gitignore = await readText(root, '.gitignore');
  const agentIgnoreFiles = files.filter((file) => /(^|\/)(?:\.claudeignore|\.cursorignore|\.aiderignore|\.codeiumignore)$/i.test(file));
  const agentIgnoreText = await readCombined(root, agentIgnoreFiles);
  const sensitiveFiles = potentiallySensitiveFiles(files);

  const workflowFiles = files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(file));
  const workflowText = await readCombined(root, workflowFiles.slice(0, 50));
  const dependencyConfig = files.filter((file) => /^(?:\.github\/dependabot\.ya?ml|renovate\.json|\.renovaterc(?:\.json)?)$/i.test(file));
  const hasSecretOrDependencyCheck = /\b(?:gitleaks|trufflehog|secretlint|detect-secrets|dependency-review|codeql|npm audit|pnpm audit|yarn audit|pip-audit|osv-scanner)\b/i.test(workflowText)
    || dependencyConfig.length > 0;
  const workflowRunsTests = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bdotnet test\b|\bmake test\b/i.test(workflowText);
  const workflowRunsQuality = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|typecheck|type-check|build|check)\b|\b(?:ruff|mypy|pyright|golangci-lint|cargo clippy)\b|\bmake (?:lint|check|build)\b/i.test(workflowText);

  const boundedGuides = rootGuides.length > 0 && guideSizes.every(({ size }) => size <= 32 * 1024);
  const describesStructure = /\b(?:repository|project|directory|package|workspace) structure\b|\b(?:src|apps|packages|services)\//i.test(guideText);
  const namesVerification = docsTestCommand || docsQualityCommand;
  const namesConstraints = /\b(?:must|never|do not|don't|avoid|only|before|after|constraint|guardrail)\b/i.test(guideText);

  const checks = [
    check('instructions.root', 'Agent instructions', 'Root agent instructions', 12, rootGuides.length > 0,
      rootGuides.length ? rootGuides.join(', ') : 'No root AGENTS.md or CLAUDE.md found.',
      'Add a concise root AGENTS.md or CLAUDE.md with repository-specific commands and boundaries.'),
    check('instructions.verify', 'Agent instructions', 'Verification guidance in agent instructions', 5, namesVerification,
      namesVerification ? 'Root instructions name at least one recognizable verification command.' : 'No recognizable test, lint, typecheck, check, or build command in root instructions.',
      'Name the exact commands an agent should run before considering work complete.'),
    check('instructions.constraints', 'Agent instructions', 'Explicit working constraints', 3, namesConstraints,
      namesConstraints ? 'Root instructions contain explicit constraint language.' : 'No explicit must/never/avoid/before/after guidance detected.',
      'Document a small set of repository-specific constraints and risky paths.'),

    check('verification.tests', 'Verification commands', 'Runnable test command', 8, hasTestCommand,
      hasTestCommand ? `Detected test configuration${testScriptNames.length ? ` (${testScriptNames.join(', ')})` : ''}.` : 'No non-placeholder test command detected in package.json, Makefile, or pyproject.toml.',
      'Provide one canonical test command in project configuration.'),
    check('verification.quality', 'Verification commands', 'Lint, typecheck, check, or build command', 6, hasQualityCommand,
      hasQualityCommand ? `Detected quality configuration${qualityScriptNames.length ? ` (${qualityScriptNames.join(', ')})` : ''}.` : 'No lint, typecheck, check, or build command detected in project configuration.',
      'Provide a canonical static-quality or build command.'),
    check('verification.docs', 'Verification commands', 'Commands documented for contributors', 6, docsTestCommand && docsQualityCommand,
      docsTestCommand && docsQualityCommand ? 'Documentation names both test and quality/build commands.' : 'Documentation does not clearly name both a test command and a quality/build command.',
      'Put copy-pasteable test and quality commands in README.md or root agent instructions.'),

    check('automation.settings', 'Agent settings and hooks', 'Agent settings or instruction config', 6, settingsFiles.length > 0,
      settingsFiles.length ? settingsFiles.slice(0, 5).join(', ') : 'No recognized agent settings file found.',
      'Check in inspectable agent settings when the repository relies on tool or permission configuration.'),
    check('automation.reusable', 'Agent settings and hooks', 'Reusable hooks, commands, skills, or agents', 5, reusableAutomationFiles.length > 0,
      reusableAutomationFiles.length ? `${reusableAutomationFiles.length} reusable automation file(s) detected.` : 'No recognized hooks, commands, skills, or agent files found.',
      'Package repeated workflows only when they are stable enough to test and maintain.'),
    check('automation.boundaries', 'Agent settings and hooks', 'Permission or tool boundaries documented', 4, hasPermissionBoundaries,
      hasPermissionBoundaries ? 'Settings or root instructions describe permission/tool/path boundaries.' : 'No recognizable permission, sandbox, tool, or protected-path boundary found.',
      'Document the intended permission level and any paths or tools that require extra care.'),

    check('secrets.gitignore', 'Secret hygiene signals', 'Repository ignore file', 3, fileSet.has('.gitignore'),
      fileSet.has('.gitignore') ? '.gitignore found.' : 'No root .gitignore found.',
      'Add a root .gitignore appropriate for the project.'),
    check('secrets.envignore', 'Secret hygiene signals', 'Environment files ignored', 5, ignoresEnv(gitignore),
      ignoresEnv(gitignore) ? '.gitignore contains an environment-file pattern.' : 'No environment-file ignore pattern detected.',
      'Ignore local environment files while retaining an intentionally safe example file if useful.'),
    check('secrets.filenames', 'Secret hygiene signals', 'No obvious sensitive filenames in scanned tree', 4, sensitiveFiles.length === 0,
      sensitiveFiles.length === 0 ? 'No filenames matching the bounded review list were found.' : `Review: ${sensitiveFiles.slice(0, 5).join(', ')}${sensitiveFiles.length > 5 ? '…' : ''}`,
      'Review these filenames manually; a filename match is not proof that a secret is present.'),
    check('secrets.automation', 'Secret hygiene signals', 'Secret or dependency review automation', 3, hasSecretOrDependencyCheck,
      hasSecretOrDependencyCheck ? 'Recognized secret/dependency review automation or update configuration found.' : 'No recognized secret/dependency review workflow or update configuration found.',
      'Consider a maintained secret or dependency review step that fits the project risk model.'),

    check('context.ignore', 'Context scope', 'Agent-specific or repository context exclusions', 4, fileSet.has('.gitignore') || agentIgnoreFiles.length > 0,
      agentIgnoreFiles.length ? agentIgnoreFiles.join(', ') : fileSet.has('.gitignore') ? '.gitignore provides a baseline exclusion signal.' : 'No recognized ignore file found.',
      'Exclude generated, vendored, and local-only material from routine agent context.'),
    check('context.generated', 'Context scope', 'Generated directories excluded', 4, ignoresGeneratedDirectories(`${gitignore}\n${agentIgnoreText}`),
      ignoresGeneratedDirectories(`${gitignore}\n${agentIgnoreText}`) ? 'Ignore rules name at least one generated or vendored directory.' : 'No generated or vendored directory pattern detected in ignore files.',
      'Ignore relevant generated directories such as build output, coverage, caches, or vendored dependencies.'),
    check('context.bounded', 'Context scope', 'Root instructions are bounded', 3, boundedGuides,
      boundedGuides ? `All root instruction files are at most 32 KiB (${guideSizes.map(({ file, size }) => `${file}: ${size} B`).join(', ')}).` : rootGuides.length ? 'A root instruction file exceeds 32 KiB.' : 'No root instruction file available to size.',
      'Keep root instructions concise; move detailed procedures into scoped documents or skills.'),
    check('context.scoped', 'Context scope', 'Repository structure or scoped instructions', 4, nestedGuides.length > 0 || describesStructure,
      nestedGuides.length ? `${nestedGuides.length} nested instruction file(s) detected.` : describesStructure ? 'Root instructions describe repository structure.' : 'No nested instructions or recognizable repository-structure guidance found.',
      'Describe the important repository layout or add scoped instructions where subprojects genuinely differ.'),

    check('ci.workflows', 'Continuous integration', 'CI workflow present', 5, workflowFiles.length > 0,
      workflowFiles.length ? workflowFiles.join(', ') : 'No .github/workflows YAML file found.',
      'Add CI that runs the repository’s canonical verification commands.'),
    check('ci.tests', 'Continuous integration', 'CI runs tests', 5, workflowRunsTests,
      workflowRunsTests ? 'A recognized test command appears in CI.' : 'No recognized test command appears in CI workflow text.',
      'Run the canonical test command in CI.'),
    check('ci.quality', 'Continuous integration', 'CI runs quality or build checks', 3, workflowRunsQuality,
      workflowRunsQuality ? 'A recognized quality/build command appears in CI.' : 'No recognized lint, typecheck, check, or build command appears in CI workflow text.',
      'Run the canonical lint, typecheck, check, or build command in CI.'),
    check('ci.dependencies', 'Continuous integration', 'Dependency update configuration', 2, dependencyConfig.length > 0,
      dependencyConfig.length ? dependencyConfig.join(', ') : 'No Dependabot or Renovate configuration found.',
      'Consider automated dependency update proposals if they fit the project maintenance model.')
  ];

  const score = checks.reduce((sum, item) => sum + item.points, 0);
  const categories = Object.entries(CATEGORY_MAX).map(([name, maxScore]) => ({
    name,
    score: checks.filter((item) => item.category === name).reduce((sum, item) => sum + item.points, 0),
    maxScore
  }));
  const rating = score >= 85 ? 'Ready' : score >= 70 ? 'Solid' : score >= 50 ? 'Developing' : 'Needs foundations';

  return {
    schemaVersion: 1,
    tool: { name: 'Harden My Repo Doctor', version: TOOL_VERSION },
    generatedAt: new Date().toISOString(),
    target: displayTarget(root),
    score,
    maxScore: 100,
    rating,
    scan: { filesConsidered: files.length, truncated, maxFiles: MAX_FILES },
    categories,
    checks,
    scope: 'Static, network-free review of filenames and selected repository text/configuration. Project code is not executed. Results do not prove security, permission enforcement, or the absence of secrets.'
  };
}

export function renderMarkdown(report) {
  const missed = report.checks.filter((item) => !item.passed).slice(0, 6);
  const lines = [
    '# Harden My Repo Doctor report',
    '',
    `**Score:** ${report.score}/${report.maxScore} — **${report.rating}**`,
    '',
    `Target: \`${report.target}\`  `,
    `Generated: ${report.generatedAt}`,
    '',
    '## Category scores',
    '',
    '| Category | Score |',
    '|---|---:|',
    ...report.categories.map((category) => `| ${escapeTable(category.name)} | ${category.score}/${category.maxScore} |`),
    '',
    '## Evidence',
    '',
    '| Result | Check | Evidence |',
    '|---|---|---|',
    ...report.checks.map((item) => `| ${item.passed ? 'Pass' : 'Gap'} | ${escapeTable(item.label)} (${item.points}/${item.maxPoints}) | ${escapeTable(item.evidence)} |`),
    '',
    '## Suggested next steps',
    ''
  ];

  if (missed.length === 0) lines.push('No scored gaps were detected. Keep the evidence current as the repository changes.');
  else missed.forEach((item, index) => lines.push(`${index + 1}. **${item.label}:** ${item.recommendation}`));

  lines.push(
    '',
    '## Scope and limitations',
    '',
    report.scope,
    '',
    `Optional: [free Harden My Repo audit](${RESOURCE_URL}).`
  );
  return `${lines.join('\n')}\n`;
}

function usage() {
  return `Harden My Repo Doctor ${TOOL_VERSION}\n\nUsage:\n  node src/cli.mjs [path] [options]\n\nOptions:\n  --markdown <file>   Markdown report path (default: harden-my-repo-report.md)\n  --json <file>       JSON report path (default: harden-my-repo-report.json)\n  --no-markdown       Do not write a Markdown report\n  --no-json           Do not write a JSON report\n  --fail-below <0-100>  Exit 1 when the score is below this threshold\n  --github-summary    Append the Markdown report to GITHUB_STEP_SUMMARY when available\n  --no-github-summary Do not append a GitHub job summary (CLI default)\n  --quiet             Do not print the score summary\n  --help              Show this help\n`;
}

export function parseArguments(argv) {
  const options = {
    target: '.',
    markdown: 'harden-my-repo-report.md',
    json: 'harden-my-repo-report.json',
    failBelow: 0,
    githubSummary: false,
    quiet: false,
    help: false
  };
  let positionalSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--github-summary') options.githubSummary = true;
    else if (argument === '--no-github-summary') options.githubSummary = false;
    else if (argument === '--no-markdown') options.markdown = null;
    else if (argument === '--no-json') options.json = null;
    else if (argument === '--markdown' || argument === '--json' || argument === '--fail-below') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === '--markdown') options.markdown = value;
      else if (argument === '--json') options.json = value;
      else {
        const threshold = Number(value);
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('--fail-below must be between 0 and 100.');
        options.failBelow = threshold;
      }
    } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else if (!positionalSeen) {
      options.target = argument;
      positionalSeen = true;
    } else throw new Error(`Unexpected argument: ${argument}`);
  }
  return options;
}

async function writeReport(filename, contents) {
  const absolute = path.resolve(filename);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
  return absolute;
}

async function writeGithubOutputs(report, markdownPath, jsonPath) {
  if (!process.env.GITHUB_OUTPUT) return;
  const output = [
    `score=${report.score}`,
    `rating=${report.rating}`,
    `markdown-report=${markdownPath || ''}`,
    `json-report=${jsonPath || ''}`
  ].join('\n');
  await appendFile(process.env.GITHUB_OUTPUT, `${output}\n`);
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  const report = await auditRepository(options.target);
  const markdown = renderMarkdown(report);
  const markdownPath = options.markdown ? await writeReport(options.markdown, markdown) : null;
  const jsonPath = options.json ? await writeReport(options.json, `${JSON.stringify(report, null, 2)}\n`) : null;

  if (options.githubSummary && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  await writeGithubOutputs(report, markdownPath, jsonPath);

  if (!options.quiet) {
    process.stdout.write(`Harden My Repo Doctor: ${report.score}/100 (${report.rating})\n`);
    if (markdownPath) process.stdout.write(`Markdown: ${markdownPath}\n`);
    if (jsonPath) process.stdout.write(`JSON: ${jsonPath}\n`);
  }
  return report.score < options.failBelow ? 1 : 0;
}

let isEntryPoint = false;
if (process.argv[1]) {
  try {
    isEntryPoint = await realpath(fileURLToPath(import.meta.url)) === await realpath(path.resolve(process.argv[1]));
  } catch {
    isEntryPoint = false;
  }
}
if (isEntryPoint) {
  run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`Harden My Repo Doctor: ${error.message}\n`);
    process.exitCode = 2;
  });
}
