export default {
  framework: 'fastium',
  server: {
    port: 3000,
    host: '127.0.0.1'
  },
  hmr: {
    enabled: true,
    overlay: true
  },
  runtime: {
    lowMemoryMode: true
  }
};