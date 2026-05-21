# Fastium

> Experimental pre-alpha package for the Fastium runtime and tooling ecosystem.
>
> This project is currently in early development and is intended for experimentation and evaluation only.

Fastium is a single-package JavaScript and TypeScript ecosystem platform built around an internal compiler, bundler, runtime, HMR engine, browser IDE surface, sandbox, testing runtime, and Discord integration.

## Fastium vs Other NPM Libraries

Fastium is not a thin wrapper around an external toolchain. It is a full runtime platform that ships the compiler, parser, optimizer, bundler, HMR, websocket engine, frontend runtime, backend runtime, diagnostics, browser tooling, sandboxing, and testing lab together in one package.

Other libraries usually assemble that stack from separate packages. Fastium keeps the core execution path internal so the platform can stay low-memory, fast to boot, and consistent across Node.js, browser preview, and isolated test lab workflows.

Fastium also supports the `.fst` language pipeline, native `fast` CLI entrypoints, and isolated self-testing projects so the ecosystem can validate itself without polluting the source root.

## Core Surface

- `src/compiler` for the `.fst` compiler pipeline
- `src/bundler` for dependency graph and bundle construction
- `src/runtime` for unified platform composition
- `src/backend` for the HTTP server and middleware runtime
- `src/frontend` for browser rendering, hydration, and state
- `src/hmr` for hot module reloading
- `src/websocket` for low-level frame handling
- `src/watcher` for recursive filesystem tracking
- `src/router` for route matching and request dispatch
- `src/state` for reactive signals and stores
- `src/cache` for in-memory and persistent caching
- `src/browser` for browser launching and preview orchestration
- `src/playground` for the browser IDE model
- `src/discord` for the Discord client surface
- `src/testing` for the internal test runtime
- `src/sandbox` for isolated execution
- `src/plugins` for lifecycle hooks and transforms
- `src/diagnostics` for overlays, frames, and reports
- `src/logger` for structured logging
- `src/utils` for shared primitives

## Commands

- `npm run build`
- `npm run test`
- `npm run docs:dev`
- `npm run doctor`
- `fast dev`
- `fast build`
- `fast test`

## Examples

- `examples/backend-server.ts`
- `examples/frontend-runtime.ts`
- `examples/main.fst`
