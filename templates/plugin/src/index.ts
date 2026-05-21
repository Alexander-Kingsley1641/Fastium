import { definePlugin } from 'fastium/plugins';

export default definePlugin({
  name: 'fastium-template-plugin',
  setup(context) {
    context.logger.info('Fastium plugin template ready');
  }
});