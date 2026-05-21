export type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export interface AsyncResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: unknown;
}

export interface LoggerOptions {
  readonly scope?: string;
  readonly level?: LogLevel;
  readonly debug?: boolean;
  readonly timestamps?: boolean;
  readonly trace?: boolean;
}

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface Logger {
  readonly scope: string;
  readonly level: LogLevel;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  success(message: string, ...args: unknown[]): void;
  time(label: string): void;
  timeEnd(label: string): void;
  child(scope: string): Logger;
}

export interface EventBusMap {
  [event: string]: unknown;
}

export interface EventBus<TEvents extends EventBusMap = EventBusMap> {
  on<TKey extends keyof TEvents & string>(event: TKey, handler: (payload: TEvents[TKey]) => void): () => void;
  once<TKey extends keyof TEvents & string>(event: TKey, handler: (payload: TEvents[TKey]) => void): () => void;
  off<TKey extends keyof TEvents & string>(event: TKey, handler: (payload: TEvents[TKey]) => void): void;
  emit<TKey extends keyof TEvents & string>(event: TKey, payload: TEvents[TKey]): void;
}

export interface PluginCommand {
  readonly name: string;
  readonly description?: string;
  readonly action: (args: readonly string[]) => Promise<void> | void;
}

export interface PluginRuntimeContext {
  readonly env: Record<string, string>;
  readonly logger: Logger;
  readonly bus: EventBus;
}

export interface PluginHooks {
  setup?: (context: PluginRuntimeContext) => void | Promise<void>;
  configure?: (options: Record<string, unknown>) => void | Promise<void>;
  buildStart?: () => void | Promise<void>;
  buildEnd?: () => void | Promise<void>;
  transform?: (code: string, id: string) => string | Promise<string>;
  onHMR?: (message: HMRMessage) => void | Promise<void>;
  onCommand?: (command: PluginCommand) => void | Promise<void>;
}

export interface PluginDefinition extends PluginHooks {
  readonly name: string;
  readonly commands?: readonly PluginCommand[];
}

export interface PluginContainer {
  readonly plugins: readonly PluginDefinition[];
  use(plugin: PluginDefinition): PluginContainer;
  setup(context: PluginRuntimeContext): Promise<void>;
  transform(code: string, id: string): Promise<string>;
}

export interface RouteMatch {
  readonly path: string;
  readonly params: Record<string, string>;
}

export interface RequestContext {
  readonly request: RequestLike;
  readonly response: ResponseLike;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly state: Record<string, unknown>;
}

export interface RequestLike {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string | Uint8Array | Buffer | FormData | null;
}

export interface ResponseLike {
  statusCode: number;
  headers: Record<string, string>;
  body?: string | Uint8Array | Buffer | unknown;
  setHeader(name: string, value: string): void;
  end(body?: string | Uint8Array | Buffer): void;
}

export interface MiddlewareContext {
  readonly request: RequestContext;
  next(): Promise<void>;
}

export type Middleware = (context: MiddlewareContext) => Promise<void> | void;
export type RouteHandler = (context: RequestContext) => Promise<unknown> | unknown;

export interface WebSocketConnection {
  readonly id: string;
  readonly readyState: 0 | 1 | 2 | 3;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(data?: string | Uint8Array): void;
  pong(data?: string | Uint8Array): void;
  onMessage(listener: (data: string | Uint8Array) => void): () => void;
  onClose(listener: (code: number, reason: string) => void): () => void;
}

export interface RouteDefinition {
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandler;
}

export interface ServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly logger?: Logger;
  readonly env?: Record<string, string>;
  readonly plugins?: readonly PluginDefinition[];
}

export interface UploadFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly buffer: Uint8Array;
}

export interface ServerRuntime {
  readonly routes: readonly RouteDefinition[];
  readonly middlewares: readonly Middleware[];
  readonly logger: Logger;
  use(middleware: Middleware): ServerRuntime;
  route(method: string, path: string, handler: RouteHandler): ServerRuntime;
  start(): Promise<ServerHandle>;
  stop(): Promise<void>;
  onUpgrade(handler: WebSocketUpgradeHandler): ServerRuntime;
}

export interface ServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

export interface WebSocketUpgradeHandler {
  (socket: WebSocketConnection, request: RequestContext): void;
}

export interface WatchEvent {
  readonly kind: 'add' | 'change' | 'unlink' | 'ready' | 'error';
  readonly path?: string;
  readonly detail?: unknown;
}

export interface WatcherHandle {
  readonly bus: EventBus<{ watch: WatchEvent }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  track(path: string, dependencies?: readonly string[]): void;
  invalidate(path: string): void;
}

export interface HMRUpdate {
  readonly type: 'reload' | 'replace' | 'invalidate';
  readonly path: string;
  readonly payload?: unknown;
}

export interface HMRServer {
  readonly bus: EventBus<{ update: HMRUpdate; connection: string }>;
  connect(socket: WebSocketConnection): void;
  broadcast(update: HMRUpdate): void;
  attachWatcher(watcher: WatcherHandle): void;
}

export interface Signal<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: (value: T) => void): () => void;
}

export interface Store<TState> {
  getState(): TState;
  setState(updater: Partial<TState> | ((current: TState) => TState)): void;
  subscribe(listener: (state: TState) => void): () => void;
}

export interface Component<P = Record<string, unknown>> {
  readonly name?: string;
  render(props: P): string | HTMLElement | DocumentFragment;
}

export interface RouterRoute {
  readonly path: string;
  readonly load: () => Promise<unknown> | unknown;
}

export interface RouterRuntime {
  navigate(path: string): void;
  current(): string;
  match(path: string): RouterRoute | undefined;
  preload(path: string): Promise<unknown>;
}

export interface AppRuntime {
  mount(target: string | HTMLElement): Promise<void>;
  hydrate(target: string | HTMLElement): Promise<void>;
  use(plugin: PluginDefinition): AppRuntime;
  signal<T>(value: T): Signal<T>;
  store<TState extends Record<string, unknown>>(state: TState): Store<TState>;
  route(path: string, load: () => Promise<unknown> | unknown): AppRuntime;
}

export interface ConfigFile {
  readonly root?: string;
  readonly mode?: 'development' | 'production' | 'test';
  readonly server?: Partial<ServerOptions>;
  readonly plugins?: readonly PluginDefinition[];
}

export interface EnvConfig {
  readonly values: Record<string, string>;
  get(key: string, fallback?: string): string;
}

export interface DevtoolsBridge {
  readonly connected: boolean;
  send(event: string, payload: unknown): void;
  inspect(): Promise<unknown[]>;
}

export interface HMRMessage {
  readonly type: string;
  readonly path?: string;
  readonly payload?: unknown;
}
