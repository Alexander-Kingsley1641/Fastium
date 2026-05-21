# Fastium

Fastium is a compiler-driven platform for Node.js and browser runtimes with internal systems for compiler transforms, bundling, HMR, caching, diagnostics, sandboxing, and browser IDE workflows.

## Why Fastium Differs From Typical NPM Libraries

Most NPM libraries contribute one slice of the stack. Fastium owns the whole execution path: compiler, lexer, parser, optimizer, bundler, HMR engine, websocket runtime, browser preview surface, backend server, Discord runtime, diagnostics, and testing lab.

That design keeps the platform unified and lightweight. Instead of stitching together Vite, Webpack, Rollup, test frameworks, websocket packages, and bot frameworks, Fastium uses its internal subsystems to validate projects in isolated folders, benchmark startup and memory, and keep runtime behavior consistent across environments.

## Goals

- ESM-first and TypeScript-first
- Works in Node.js and browser runtimes
- Plugin-driven and tree-shakeable
- Built for fast iteration, low memory retention, and production deployment
