export const getHmrClientScript = (): string => {
  return `// Fastium HMR client (minimal)
;(function(){
  const WS_PATH = (typeof __FASTIUM_HMR_PATH__ !== 'undefined') ? __FASTIUM_HMR_PATH__ : '/fastium-hmr';
  const url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + WS_PATH;
  const decoder = new TextDecoder();

  const createOverlay = () => {
    const overlay = document.createElement('div');
    overlay.id = 'fastium-hmr-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(11, 13, 18, 0.95)';
    overlay.style.color = '#f8fafc';
    overlay.style.padding = '24px';
    overlay.style.zIndex = '2147483647';
    overlay.style.overflow = 'auto';
    overlay.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
    overlay.innerHTML = '<h1>Fastium HMR Error</h1><pre id="fastium-hmr-stack" style="white-space: pre-wrap; margin-top: 16px;"></pre>';
    document.body.appendChild(overlay);
    return overlay;
  };

  const decodePackets = (buffer) => {
    const packets = [];
    const view = new DataView(buffer);
    let offset = 0;
    while (offset + 5 <= buffer.byteLength) {
      const version = view.getUint8(offset);
      if (version !== 1) break;
      const len = view.getUint32(offset + 1, false);
      const start = offset + 5;
      const end = start + len;
      if (end > buffer.byteLength) break;
      const slice = new Uint8Array(buffer, start, len);
      try {
        packets.push(JSON.parse(decoder.decode(slice)));
      } catch (_e) {
        // ignore broken packet
      }
      offset = end;
    }
    return packets;
  };

  const ensureHmr = () => {
    const global = /** @type {any} */ (window);
    if (!global.__FASTIUM_HMR__) {
      const modules = new Map();
      const acceptHandlers = new Map();
      const disposeHandlers = new Map();

      const unregister = (moduleId) => {
        modules.delete(moduleId);
        acceptHandlers.delete(moduleId);
        disposeHandlers.delete(moduleId);
      };

      const applyUpdate = async (moduleId, code) => {
        try {
          const dispose = disposeHandlers.get(moduleId);
          if (dispose) {
            await dispose();
          }
          const blob = new Blob([code], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          const imported = await import(url);
          URL.revokeObjectURL(url);
          const callback = acceptHandlers.get(moduleId);
          if (callback) {
            await callback(imported);
            return;
          }
          if (imported && imported.default && typeof imported.default === 'object' && typeof imported.default.hmr === 'function') {
            await imported.default.hmr({ moduleId, hot: global.__FASTIUM_HMR__ });
            return;
          }
          location.reload();
        } catch (error) {
          console.error('Fastium HMR apply failed', error);
          const overlay = document.getElementById('fastium-hmr-overlay') || createOverlay();
          const stackEl = overlay.querySelector('#fastium-hmr-stack');
          if (stackEl) {
            stackEl.textContent = String(error.stack ?? error.message ?? error);
          }
        }
      };

      global.__FASTIUM_HMR__ = {
        registerModule(moduleId, api) {
          modules.set(moduleId, api);
        },
        accept(moduleId, handler) {
          acceptHandlers.set(moduleId, handler);
        },
        dispose(moduleId, handler) {
          disposeHandlers.set(moduleId, handler);
        },
        applyUpdate,
        unregister,
        modules,
        acceptHandlers,
        disposeHandlers
      };
    }
    return global.__FASTIUM_HMR__;
  };

  const hmr = ensureHmr();
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('message', (ev) => {
    try {
      const packets = typeof ev.data === 'string' ? [JSON.parse(ev.data)] : decodePackets(ev.data);
      for (const pkt of packets) {
        if (!pkt || typeof pkt !== 'object') continue;
        if (pkt.type === 'reload') {
          console.info('Fastium HMR reload');
          location.reload();
          return;
        }
        if (pkt.type === 'error') {
          console.error('Fastium HMR runtime error', pkt.payload);
          const overlay = document.getElementById('fastium-hmr-overlay') || createOverlay();
          const stackEl = overlay.querySelector('#fastium-hmr-stack');
          if (stackEl) {
            stackEl.textContent = String(pkt.payload?.stack ?? pkt.payload?.message ?? pkt.payload);
          }
          return;
        }
        if (pkt.type === 'update' && pkt.moduleId && pkt.payload && pkt.payload.code) {
          hmr.applyUpdate(pkt.moduleId, pkt.payload.code);
          continue;
        }
        if (pkt.type === 'invalidate') {
          console.info('Fastium HMR invalidate', pkt.moduleId);
          continue;
        }
      }
    } catch (error) {
      console.error('Fastium HMR client error', error);
    }
  });

  socket.addEventListener('close', () => {
    console.warn('Fastium HMR socket closed');
  });
})();
`;
};
