import { createApp, defineComponent } from 'fastium';

const App = defineComponent('App', () => `
  <section>
    <h1>Fastium Frontend Runtime</h1>
    <p>Signals, routing, hydration, and plugin-ready runtime primitives.</p>
  </section>
`);

const app = createApp();
app.route('/', () => App);

if (typeof document !== 'undefined') {
  await app.mount('#app');
}
