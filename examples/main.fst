import { createApp } from 'fastium/frontend';

const app = createApp();

app.route('/', () => ({
  render: () => '<main><h1>Fastium</h1><p>Fastium .fst example</p></main>'
}));

export default app;