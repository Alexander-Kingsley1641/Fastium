# Getting Started

Fastium is organized as a single package with a compiler-first source tree under `src/`. The platform ships one CLI, one runtime entry, and one package name.

It is designed to behave like a full runtime platform rather than a conventional library: the compiler, bundler, HMR engine, browser preview, Discord runtime, and internal test lab all live inside the same package and can validate isolated projects under `testing-lab/`.

## Recommended flow

1. Install dependencies at the repository root.
2. Run `npm run build` to compile the platform.
3. Use `npm run docs:dev` for the documentation site.
4. Scaffold a project with `fast create` after building the CLI.

## Core package map

- `fastium` for the unified platform API
- `fastium/backend` for server runtime
- `fastium/frontend` for browser runtime
- `fastium/hmr` for hot module reloading
- `fastium/watcher` for filesystem tracking
- `fastium/discord` for bot and gateway primitives
