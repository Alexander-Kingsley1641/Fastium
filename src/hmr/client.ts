export const getHmrClientScript = (): string => {
  return `// Fastium HMR client (minimal)
;(function(){
  const WS_PATH = (typeof __FASTIUM_HMR_PATH__ !== 'undefined') ? __FASTIUM_HMR_PATH__ : '/fastium-hmr';
  const toWs = (url) => url.replace(/^http/, 'ws');
  const url = toWs(location.origin) + WS_PATH;
  const socket = new WebSocket(url);
  const decoder = new TextDecoder();

  function decodePackets(buffer){
    const out = [];
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
      try { out.push(JSON.parse(decoder.decode(slice))); } catch {};
      offset = end;
    }
    return out;
  }

  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (ev) => {
    try {
      if (typeof ev.data === 'string') {
        const pkt = JSON.parse(ev.data);
        console.debug('fastium:hmr', pkt);
        return;
      }

      const packets = decodePackets(ev.data);
      for (const pkt of packets) {
        try { console.debug('fastium:hmr', pkt.type, pkt.moduleId, pkt.payload); } catch(e){}
        if (pkt.type === 'reload') {
          location.reload();
        }
      }
    } catch (err) {
      console.error('Fastium HMR client error', err);
    }
  });

  socket.addEventListener('close', () => {
    console.warn('Fastium HMR socket closed, will not reconnect automatically');
  });
})();
`;
};
