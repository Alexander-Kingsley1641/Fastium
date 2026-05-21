#!/usr/bin/env node
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFastium } from '../runtime/index.js';
import { createLogger } from '../logger/index.js';
import { createCompiler } from '../compiler/index.js';
import { benchmark } from '../testing/index.js';
import { runNativeBenchmarkSuite } from '../native/benchmark/index.js';

interface ParsedArguments {
  command: string;
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

const LAB_TEST_SUITES = new Set(['frontend', 'backend', 'discord', 'websocket', 'build', 'all']);

const logger = createLogger({ scope: 'fastium:cli', debug: process.argv.includes('--debug') });

const parseArguments = (argv: string[]): ParsedArguments => {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument.startsWith('--')) {
      const [name, inlineValue] = argument.split('=', 2);
      if (inlineValue !== undefined) {
        values.set(name, inlineValue);
      } else if (argv[index + 1] && !argv[index + 1].startsWith('-')) {
        values.set(name, argv[index + 1]);
        index += 1;
      } else {
        flags.add(name);
      }
    } else if (argument.startsWith('-') && argument.length > 1) {
      flags.add(argument);
    } else {
      positionals.push(argument);
    }
  }

  return {
    command: positionals[0] ?? 'dev',
    positionals: positionals.slice(1),
    flags,
    values
  };
};

const renderHelp = (): string => `Fastium

Usage:
  fast
  fast build
  fast start
  fast test [frontend|backend|discord|websocket|build]
  fast doctor
  fast analyze
  fast create [name] [destination] [template]

Flags:
  --debug        Enable debug logs
  --benchmark    Run the internal compiler benchmark for fast test
  --watch        Keep test mode active
  --keep         Keep generated testing-lab project files
  --help         Show this help
  --version      Show package version`;

const prompt = async (question: string, fallback = ''): Promise<string> => {
  const interfaceInstance = createInterface({ input: stdin, output: stdout });
  const answer = await interfaceInstance.question(`${question} `);
  interfaceInstance.close();
  return answer.trim() || fallback;
};

const loadConfig = async (rootDir: string): Promise<Record<string, unknown>> => {
  for (const candidate of ['fast.config.js', 'fast.config.mjs']) {
    try {
      const module = await import(pathToFileURL(path.join(rootDir, candidate)).href);
      return module.default ?? module;
    } catch {
      continue;
    }
  }

  return {};
};

const copyDirectory = async (source: string, destination: string): Promise<void> => {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else {
      await copyFile(sourcePath, destinationPath);
    }
  }
};

const scaffoldProject = async (rootDir: string, name: string, destination: string, templateName: string): Promise<string> => {
  const templatePath = path.join(rootDir, 'templates', templateName);
  const targetPath = path.resolve(destination);
  await copyDirectory(templatePath, targetPath);
  await writeFile(path.join(targetPath, 'fast.config.js'), `export default {\n  name: ${JSON.stringify(name)},\n  framework: 'fastium',\n  server: { port: 3000, host: '127.0.0.1' }\n};\n`, 'utf8');
  return targetPath;
};

const runCreate = async (rootDir: string, positionals: string[]): Promise<void> => {
  const name = positionals[0] ?? await prompt('Project name?', 'fastium-app');
  const destination = positionals[1] ?? await prompt('Destination directory?', path.join(rootDir, name));
  const template = positionals[2] ?? await prompt('Template? (basic/plugin)', 'basic');
  const createdAt = await scaffoldProject(rootDir, name, destination, template);
  logger.success(`Created ${name} at ${createdAt}`);
};

const runDoctor = async (rootDir: string): Promise<void> => {
  const config = await loadConfig(rootDir);
  const checks = [
    ['node', process.version],
    ['cwd', rootDir],
    ['package.json', await stat(path.join(rootDir, 'package.json')).then(() => 'present').catch(() => 'missing')],
    ['src/index.ts', await stat(path.join(rootDir, 'src', 'index.ts')).then(() => 'present').catch(() => 'missing')],
    ['templates/basic', await stat(path.join(rootDir, 'templates', 'basic')).then(() => 'present').catch(() => 'missing')],
    ['framework', String(config.framework ?? 'fastium')]
  ];

  for (const [label, value] of checks) {
    logger.info(`${label}: ${value}`);
  }
};

const runDev = async (rootDir: string): Promise<void> => {
  const config = await loadConfig(rootDir);
  const runtime = createFastium({ ...(config as Record<string, unknown>), rootDir });
  const result = await runtime.dev();
  logger.success(`Fastium dev server ready at ${result.server.url}`);
};

const runStart = async (rootDir: string): Promise<void> => {
  const config = await loadConfig(rootDir);
  const runtime = createFastium({ ...(config as Record<string, unknown>), rootDir, mode: 'production' });
  const handle = await runtime.start();
  logger.success(`Fastium server started at ${(handle as { url?: string }).url ?? 'unknown'}`);
};

const runBuild = async (rootDir: string): Promise<void> => {
  const config = await loadConfig(rootDir);
  const runtime = createFastium({ ...(config as Record<string, unknown>), rootDir, mode: 'production' });
  try {
    const bundle = await runtime.build((config.entry as string | undefined) ?? 'examples/main.fst');
    await mkdir(path.join(rootDir, 'dist'), { recursive: true });
    await writeFile(path.join(rootDir, 'dist', 'fastium-build.json'), JSON.stringify(bundle, null, 2), 'utf8');
    logger.success('Fastium build artifacts written to dist/');
  } finally {
    await runtime.dispose();
  }
};

const runAnalyze = async (rootDir: string): Promise<void> => {
  const config = await loadConfig(rootDir);
  const runtime = createFastium({ ...(config as Record<string, unknown>), rootDir, mode: 'production' });
  try {
    const report = await runtime.analyze((config.entry as string | undefined) ?? 'examples/main.fst');
    logger.info(JSON.stringify(report, null, 2));
  } finally {
    await runtime.dispose();
  }
};

const runTest = async (rootDir: string, flags: Set<string>): Promise<void> => {
  const config = await loadConfig(rootDir);
  const runtime = createFastium({ ...(config as Record<string, unknown>), rootDir, mode: 'test' });

  if (flags.has('--benchmark')) {
    const compiler = createCompiler({ logger: logger.child('benchmark') });
    const sample = "import { createApp } from 'fastium/frontend'\nconst app = createApp()\nexport default app";
    const result = await benchmark('compiler', async () => {
      await compiler.compileSource(sample);
    }, 250);
    logger.info(`benchmark ${result.name}: ${(result.durationMs / result.iterations).toFixed(4)}ms avg over ${result.iterations} runs`);
    const nativeReport = await runNativeBenchmarkSuite(sample);
    logger.info(JSON.stringify({
      native: nativeReport.results.map(item => ({
        name: item.name,
        durationMs: item.durationMs,
        status: item.status,
        retainedHeap: item.retainedHeap
      }))
    }, null, 2));
    return;
  }

  const summary = await runtime.test();
  logger.info(JSON.stringify(summary, null, 2));

  if (flags.has('--watch')) {
    logger.warn('watch mode is active but no filesystem test discovery is registered yet');
  }
};

const runTestLab = async (rootDir: string, suite: string, flags: Set<string>): Promise<void> => {
  const { createTestLab } = await import('../testing-lab/index.js');
  const lab = createTestLab({ rootDir, logger: logger.child('lab') });
  const normalizedSuite = suite === 'build' ? 'frontend-build-test' : suite === 'frontend' ? 'frontend-test' : suite === 'backend' ? 'backend-test' : suite === 'discord' ? 'discord-test' : suite === 'websocket' ? 'websocket-test' : suite;

  if (normalizedSuite === 'all') {
    await lab.runAll();
    return;
  }

  const result = await lab.runSuite(normalizedSuite as 'frontend-test' | 'backend-test' | 'discord-test' | 'websocket-test' | 'frontend-build-test');
  if (flags.has('--keep') === false && result.status === 'passed') {
    await lab.cleanup({ rootDir: lab.rootDir, generatedAt: new Date().toISOString(), total: 1, passed: 1, failed: 0, durationMs: result.durationMs, suites: [result] });
  }
};

export const runCli = async (): Promise<void> => {
  const rootDir = process.cwd();
  const { command, positionals, flags } = parseArguments(process.argv.slice(2));

  if (flags.has('--help') || flags.has('-h') || command === 'help') {
    logger.info(renderHelp());
    return;
  }

  if (flags.has('--version') || flags.has('-v') || command === 'version') {
    const packageJson = await import(pathToFileURL(path.join(rootDir, 'package.json')).href).catch(() => ({ default: { version: 'unknown' } }));
    logger.info(String((packageJson as { default?: { version?: string }; version?: string }).default?.version ?? (packageJson as { version?: string }).version ?? 'unknown'));
    return;
  }

  if (command === 'create') {
    await runCreate(rootDir, positionals);
    return;
  }

  if (command === 'doctor') {
    await runDoctor(rootDir);
    return;
  }

  if (command === 'dev' || command === 'serve') {
    await runDev(rootDir);
    return;
  }

  if (command === 'start') {
    await runStart(rootDir);
    return;
  }

  if (command === 'build') {
    await runBuild(rootDir);
    return;
  }

  if (command === 'analyze') {
    await runAnalyze(rootDir);
    return;
  }

  if (command === 'test') {
    const suite = positionals[0];
    if (suite && LAB_TEST_SUITES.has(suite)) {
      await runTestLab(rootDir, suite, flags);
      return;
    }

    await runTest(rootDir, flags);
    return;
  }

  if (command === 'test-lab') {
    await runTestLab(rootDir, 'all', flags);
    return;
  }

  logger.info(renderHelp());
};

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  await runCli();
}

export { createFastium } from '../runtime/index.js';
export { createServer } from '../backend/index.js';
export { createApp, defineComponent } from '../frontend/index.js';
export { createLogger } from '../logger/index.js';
export { definePlugin } from '../plugins/index.js';
export { deepMerge, createEventBus, randomID } from '../utils/index.js';
