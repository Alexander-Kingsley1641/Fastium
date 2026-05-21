import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createLogger, type Logger } from '../logger/index.js';

export interface TestCase {
  name: string;
  run: () => void | Promise<void>;
}

export interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: unknown;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: TestResult[];
}

const registry: TestCase[] = [];

export const test = (name: string, run: () => void | Promise<void>): void => {
  registry.push({ name, run });
};

export const expect = <T>(received: T) => ({
  toBe(expected: T) {
    assert.strictEqual(received, expected);
  },
  toEqual(expected: T) {
    assert.deepStrictEqual(received, expected);
  },
  toContain(expected: unknown) {
    assert.ok(Array.isArray(received) ? received.includes(expected as never) : String(received).includes(String(expected)));
  },
  toBeTruthy() {
    assert.ok(received);
  },
  toBeFalsy() {
    assert.ok(!received);
  }
});

export const runTests = async (tests: TestCase[] = registry, logger: Logger = createLogger({ scope: 'fastium:test' })): Promise<TestSummary> => {
  const startedAt = performance.now();
  const results: TestResult[] = [];

  for (const testCase of tests) {
    const testStartedAt = performance.now();
    try {
      await testCase.run();
      const durationMs = performance.now() - testStartedAt;
      results.push({ name: testCase.name, status: 'passed', durationMs });
      logger.success(`PASS ${testCase.name} (${durationMs.toFixed(1)}ms)`);
    } catch (error) {
      const durationMs = performance.now() - testStartedAt;
      results.push({ name: testCase.name, status: 'failed', durationMs, error });
      logger.error(`FAIL ${testCase.name} (${durationMs.toFixed(1)}ms)`, error);
    }
  }

  const durationMs = performance.now() - startedAt;
  const passed = results.filter(result => result.status === 'passed').length;
  const failed = results.length - passed;
  logger.info(`Test summary: ${passed}/${results.length} passed in ${durationMs.toFixed(1)}ms`);

  return {
    total: results.length,
    passed,
    failed,
    durationMs,
    results
  };
};

export const benchmark = async (name: string, run: () => void | Promise<void>, iterations = 1000, logger: Logger = createLogger({ scope: 'fastium:benchmark' })) => {
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await run();
  }
  const durationMs = performance.now() - startedAt;
  logger.info(`Benchmark ${name}: ${iterations} iterations in ${durationMs.toFixed(1)}ms`);
  return { name, iterations, durationMs };
};

export const createTestRuntime = (options: { logger?: Logger } = {}) => ({
  register: test,
  expect,
  run: (tests: TestCase[] = registry) => runTests(tests, options.logger),
  benchmark: (name: string, run: () => void | Promise<void>, iterations = 1000) => benchmark(name, run, iterations, options.logger),
  clear() {
    registry.length = 0;
  }
});