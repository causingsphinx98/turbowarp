// Ping extension for TurboWarp / Scratch 3
// Save as ping-extension.js and load into TurboWarp as a custom extension URL.
// NOTE: This uses HTTP(S) requests from the browser (no ICMP). See limitations above.

(function() {
  class PingExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._lastError = '';
    }

    getInfo() {
      return {
        id: 'httpPing',
        name: 'HTTP Ping',
        blocks: [
          {
            opcode: 'pingUrl',
            blockType: 'COMMAND',
            text: 'ping [URL] (timeout: [TIMEOUT] ms)',
            arguments: {
              URL: { type: 'STRING', defaultValue: 'https://example.com' },
              TIMEOUT: { type: 'NUMBER', defaultValue: 3000 }
            }
          },
          {
            opcode: 'pingLatency',
            blockType: 'REPORTER',
            text: 'latency of [URL] (ms, -1 on fail)',
            arguments: {
              URL: { type: 'STRING', defaultValue: 'https://example.com' }
            }
          },
          {
            opcode: 'pingReachable',
            blockType: 'BOOLEAN',
            text: 'reachable [URL] within [TIMEOUT] ms',
            arguments: {
              URL: { type: 'STRING', defaultValue: 'https://example.com' },
              TIMEOUT: { type: 'NUMBER', defaultValue: 3000 }
            }
          },
          {
            opcode: 'lastError',
            blockType: 'REPORTER',
            text: 'last ping error'
          }
        ],
        menus: {}
      };
    }

    // COMMAND: perform a ping (fire-and-forget)
    async pingUrl(args) {
      const url = String(args.URL).trim();
      const timeout = Number(args.TIMEOUT) || 3000;
      this._lastError = '';
      try {
        await this._doFetch(url, timeout);
      } catch (e) {
        // record error for user
        this._lastError = e && e.message ? String(e.message) : String(e);
      }
    }

    // REPORTER: return measured latency in ms; -1 on failure
    async pingLatency(args) {
      const url = String(args.URL).trim();
      this._lastError = '';
      try {
        const t0 = performance.now();
        await this._doFetch(url, 10000); // allow generous timeout for a standalone latency check
        const latency = Math.round(performance.now() - t0);
        return latency;
      } catch (e) {
        this._lastError = e && e.message ? String(e.message) : String(e);
        return -1;
      }
    }

    // BOOLEAN: reachable within timeout?
    async pingReachable(args) {
      const url = String(args.URL).trim();
      const timeout = Number(args.TIMEOUT) || 3000;
      this._lastError = '';
      try {
        await this._doFetch(url, timeout);
        return true;
      } catch (e) {
        this._lastError = e && e.message ? String(e.message) : String(e);
        return false;
      }
    }

    // REPORTER: last error string (empty if none)
    lastError() {
      return this._lastError || '';
    }

    // Internal helper: perform fetch with timeout and some CORS fallback heuristics.
    async _doFetch(rawUrl, timeoutMs) {
      if (!rawUrl) throw new Error('Empty URL');

      // If user provided an IP or hostname without scheme, assume http://
      let url = rawUrl;
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
        url = 'http://' + url;
      }

      // Basic validation
      try {
        new URL(url);
      } catch (e) {
        throw new Error('Invalid URL: ' + rawUrl);
      }

      // Setup abort controller for timeout
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), Math.max(50, timeoutMs));

      // Primary attempt: try a CORS-friendly GET (most likely to succeed for public APIs).
      // We use GET because some servers block HEAD or preflight; GET is most compatible.
      try {
        const resp = await fetch(url, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-store',
          signal: controller.signal,
          // no credentials by default; add "credentials" only if you understand implications
        });
        clearTimeout(timerId);
        // If we get a network-level error, fetch throws. If response is 4xx/5xx, it's still considered reachable
        // but we treat non-OK as still "reachable" (HTTP responded). You can inspect status if needed here.
        return resp;
      } catch (firstErr) {
        // If the CORS attempt was blocked, some browsers will throw a TypeError. Try fallback to no-cors,
        // which returns an opaque response (we can't read headers/status), but the request still leaves the browser
        // and can be useful to measure timing.
        if (controller.signal.aborted) {
          clearTimeout(timerId);
          throw new Error('Request timed out');
        }

        try {
          const fallbackController = new AbortController();
          const t2 = setTimeout(() => fallbackController.abort(), Math.max(50, timeoutMs));
          const resp2 = await fetch(url, {
            method: 'GET',
            mode: 'no-cors', // opaque response — we can't inspect status, but the request is still made
            cache: 'no-store',
            signal: fallbackController.signal
          });
          clearTimeout(t2);
          // Opaque responses don't let us check status; we treat completion as success.
          return resp2;
        } catch (fallbackErr) {
          // If even fallback fails, rethrow a helpful message
          clearTimeout(timerId);
          const msg = (fallbackErr && fallbackErr.message) ? fallbackErr.message : String(fallbackErr);
          throw new Error('Network error or blocked by CORS: ' + msg);
        }
      } finally {
        // ensure cleanup if the timeout fired earlier
        try { clearTimeout(timerId); } catch (e) {}
      }
    }
  }

  // Register extension for Scratch / TurboWarp:
  // TurboWarp / Scratch 3 custom extension loaders often accept a global registration.
  // Try the Scratch legacy register if present, otherwise attach to window for manual registration.
  if (typeof Scratch !== 'undefined' && Scratch.extensions && typeof Scratch.extensions.register === 'function') {
    try {
      Scratch.extensions.register(new PingExtension());
      console.log('HTTP Ping extension registered via Scratch.extensions.register()');
    } catch (e) {
      // ignore; fall back to attaching to window
      window.PingExtension = PingExtension;
      console.log('HTTP Ping extension attached to window.PingExtension (register failed).');
    }
  } else {
    // Expose constructor to window so TurboWarp or other loaders can instantiate it.
    window.PingExtension = PingExtension;
    console.log('HTTP Ping extension constructor available at window.PingExtension');
  }
})();
