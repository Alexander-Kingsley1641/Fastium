import { createApp } from 'fastium/frontend';

const app = createApp();

app.route('/', () => ({
  render: () => '<div id="app">Fastium template</div>'
}));

export default app;