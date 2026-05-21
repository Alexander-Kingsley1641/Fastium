import { createServer } from '@alexium/backend';
import { createLogger } from '@alexium/logger';
const logger = createLogger({ scope: 'example:backend', debug: true });
const server = createServer({ port: 4000, host: '127.0.0.1', logger });
server.use(async ({ request, next }) => {
    logger.info(`${request.request.method} ${request.request.url}`);
    await next();
});
server.get('/', () => ({ ok: true, service: 'alexium-backend' }));
server.get('/health', () => ({ status: 'healthy', time: new Date().toISOString() }));
await server.start();
