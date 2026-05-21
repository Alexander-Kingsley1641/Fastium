import { createFastium, createServer, createApp, defineComponent, createLogger, definePlugin, deepMerge, createEventBus, randomID } from 'fastium';

const logger = createLogger({ scope: 'smoke-test', debug: true });
const bus = createEventBus();
const merged = deepMerge({ runtime: 'fastium' }, { package: 'smoke' });

const plugin = definePlugin({
  name: 'smoke-plugin',
  setup(context) {
    context.logger.info('plugin setup ok');
  }
});

const framework = createFastium({
  mode: 'development',
  server: { port: 0, host: '127.0.0.1' },
  plugins: [plugin]
});

await framework.bootstrap();

const server = createServer({ port: 0, host: '127.0.0.1', logger });
server.get('/health', () => ({ ok: true, id: randomID('health') }));
const handle = await server.start();
await server.stop();

const app = createApp();
const component = defineComponent('SmokeCard', () => '<div>Fastium smoke test</div>');
app.route('/', () => component);

bus.emit('ready', merged);

console.log(JSON.stringify({
  ok: true,
  framework: Boolean(framework),
  server: handle.url,
  merged,
  component: component.name
}, null, 2));
