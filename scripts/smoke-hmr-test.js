import { createFastium } from '../src/runtime/index.js';

(async () => {
  const rt = createFastium({ rootDir: process.cwd() });
  await rt.bootstrap();
  rt.hmr.update('examples/main.fst', { code: 'changed' });
  console.log('sent update');
  // allow background tasks
  await new Promise(r => setTimeout(r, 200));
  await rt.dispose();
})();
