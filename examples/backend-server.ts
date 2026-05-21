import { createServer, createLogger } from 'fastium';

const logger = createLogger({ scope: 'example:backend', debug: true });
const server = createServer({ port: 4000, host: '127.0.0.1', logger });

server.use(async context => {
  const request = context.request as { method?: string; url?: string };
  logger.info(`${request.method} ${request.url}`);
});

server.get('/', () => ({ ok: true, service: 'fastium-backend' }));
server.get('/health', () => ({ status: 'healthy', time: new Date().toISOString() }));

await server.start();
