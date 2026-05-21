#!/usr/bin/env node
import { mkdir, readdir, stat, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createServer } from '@alexium/backend';
import { createLogger } from '@alexium/logger';
import { createDevtoolsBridge } from '@alexium/devtools';
import { createAlexium } from '@alexium/core';

const root = process.cwd();
const logger = createLogger({ scope: 'alexium-cli', debug: process.argv.includes('--debug') });

const prompt = async (question: string, fallback = '') => {
  const interfaceInstance = createInterface({ input: stdin, output: stdout });
  const answer = await interfaceInstance.question(`${question} `);
  interfaceInstance.close();
  return answer.trim() || fallback;
};

const copyDirectory = async (source: string, destination: string) => {
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

const renderTemplate = async (templateName: string, destination: string) => {
  const templatePath = path.join(root, 'templates', templateName);
  const targetPath = path.resolve(destination);
  await copyDirectory(templatePath, targetPath);
  return targetPath;
};

const runCreate = async () => {
  const name = await prompt('Project name?', 'alexium-app');
  const location = await prompt('Destination directory?', path.join(root, name));
  const template = await prompt('Template? (basic/plugin)', 'basic');
  const target = await renderTemplate(template, location);

  await writeFile(path.join(target, 'alexium.config.js'), `export default {\n  name: ${JSON.stringify(name)},\n  server: { port: 3000, host: '127.0.0.1' }\n};\n`);
  logger.success(`Created ${name} at ${target}`);
};

const runDoctor = async () => {
  const checks = [
    ['node', process.version],
    ['cwd', root],
    ['package.json', await stat(path.join(root, 'package.json')).then(() => 'present').catch(() => 'missing')],
    ['templates/basic', await stat(path.join(root, 'templates', 'basic')).then(() => 'present').catch(() => 'missing')]
  ];

  for (const [label, value] of checks) {
    logger.info(`${label}: ${value}`);
  }
};

const loadConfig = async () => {
  for (const file of ['alexium.config.js', 'alexium.config.mjs']) {
    try {
      const module = await import(pathToFileURL(path.join(root, file)).href);
      return module.default ?? module;
    } catch {
      continue;
    }
  }
  return {};
};

const pathToFileURL = (input: string) => new URL(`file://${input.replace(/\\/g, '/')}`);

const runStart = async () => {
  const config = await loadConfig();
  const app = createAlexium(config);
  await app.bootstrap();
  const server = createServer(config.server ?? {});
  server.get('/', () => ({ ok: true, framework: 'alexium', mode: 'start' }));
  await server.start();
  logger.success('Alexium server started');
};

const runDev = async () => {
  const config = await loadConfig();
  const runtime = createAlexium(config);
  await runtime.bootstrap();
  const server = createServer(config.server ?? {});
  const devtools = createDevtoolsBridge('alexium');
  server.get('/', () => ({ ok: true, framework: 'alexium', devtools: devtools.connected }));
  await server.start();
  logger.info('Alexium dev server ready');
};

const runBuild = async () => {
  const config = await loadConfig();
  const dist = path.join(root, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'alexium-build.json'), JSON.stringify({ builtAt: new Date().toISOString(), config }, null, 2));
  logger.success('Build artifacts written to dist/');
};

const runPluginAdd = async () => {
  const pluginName = await prompt('Plugin name?', 'example-plugin');
  const pluginDir = path.join(root, 'src', 'plugins');
  await mkdir(pluginDir, { recursive: true });
  const filePath = path.join(pluginDir, `${pluginName}.ts`);
  await writeFile(filePath, `import { definePlugin } from '@alexium/plugins';\n\nexport default definePlugin({\n  name: ${JSON.stringify(pluginName)},\n  setup() {\n    console.log(${JSON.stringify(pluginName)});\n  }\n});\n`);
  logger.success(`Plugin scaffolded at ${filePath}`);
};

const command = process.argv[2] ?? 'doctor';

if (command === 'create') {
  await runCreate();
} else if (command === 'doctor') {
  await runDoctor();
} else if (command === 'start') {
  await runStart();
} else if (command === 'dev') {
  await runDev();
} else if (command === 'build') {
  await runBuild();
} else if (command === 'plugin' && process.argv[3] === 'add') {
  await runPluginAdd();
} else if (command === '--help' || command === 'help') {
  logger.info('Commands: alexium create | dev | build | start | plugin add | doctor');
} else {
  logger.warn(`Unknown command: ${command}`);
}

export * from '@alexium/backend';
export * from '@alexium/frontend';
export * from '@alexium/core';
export * from '@alexium/devtools';

