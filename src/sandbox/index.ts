import { createRequire } from 'node:module';
import vm from 'node:vm';

export interface SandboxOptions {
  timeoutMs?: number;
  filename?: string;
  globals?: Record<string, unknown>;
}

export const createSandbox = (options: SandboxOptions = {}) => {
  const createContext = () => vm.createContext({
    console,
    URL,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    performance,
    TextEncoder,
    TextDecoder,
    ...options.globals
  });

  return {
    run(source: string, runOptions: SandboxOptions = {}) {
      const context = createContext();
      const script = new vm.Script(source, {
        filename: runOptions.filename ?? options.filename ?? 'fastium-sandbox.js'
      });
      return script.runInContext(context, { timeout: runOptions.timeoutMs ?? options.timeoutMs ?? 1000 });
    },
    async runModule(source: string, runOptions: SandboxOptions = {}) {
      const context = createContext();
      const module = { exports: {} as Record<string, unknown> };
      const require = createRequire(import.meta.url);
      const wrapper = new vm.Script(`(async (module, exports, require) => { ${source}\n; return module.exports; })`, {
        filename: runOptions.filename ?? options.filename ?? 'fastium-module.js'
      });
      const executable = wrapper.runInContext(context, { timeout: runOptions.timeoutMs ?? options.timeoutMs ?? 1000 });
      return executable(module, module.exports, require);
    }
  };
};