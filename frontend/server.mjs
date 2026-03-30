import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICE_NAME = 'frontend';
const VERSION = process.env.npm_package_version || '0.0.0';
const COMMIT = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null;

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(__dirname, 'dist');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');
const MANIFEST_FILE = path.join(DIST_DIR, 'manifest.json');
const ICON_FILE = path.join(DIST_DIR, 'Familia-512.png');

const KEEP_ALIVE_TIMEOUT_MS = parseInt(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS || '60000', 10);
const HEADERS_TIMEOUT_MS = parseInt(process.env.SERVER_HEADERS_TIMEOUT_MS || '65000', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.SERVER_REQUEST_TIMEOUT_MS || '30000', 10);
const SHUTDOWN_GRACE_MS = parseInt(process.env.SERVER_SHUTDOWN_GRACE_MS || '10000', 10);
const DIAGNOSTICS_ENABLED = process.env.DIAGNOSTICS_ENABLED !== 'false';
const DIAGNOSTICS_INTERVAL_MS = parseInt(process.env.DIAGNOSTICS_INTERVAL_MS || '60000', 10);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4'
};

let readyState = {
  ready: false,
  reason: 'initializing'
};

const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

function nowIso() {
  return new Date().toISOString();
}

function log(level, message, fields = {}) {
  const payload = {
    timestamp: nowIso(),
    level,
    service: SERVICE_NAME,
    message,
    ...fields
  };

  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'fatal') {
    console.error(line);
    return;
  }

  console.log(line);
}

function formatHealth(status) {
  return {
    status,
    service: SERVICE_NAME,
    timestamp: nowIso(),
    uptime: Math.round(process.uptime() * 1000) / 1000,
    version: VERSION,
    commit: COMMIT
  };
}

function sendJson(req, res, statusCode, body) {
  const content = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(content));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  res.end(content);
}

async function verifyFile(filePath) {
  await access(filePath);
  const fileStat = await stat(filePath);
  return fileStat.isFile();
}

async function refreshReadyState() {
  try {
    const [hasIndex, hasManifest, hasIcon] = await Promise.all([
      verifyFile(INDEX_FILE),
      verifyFile(MANIFEST_FILE),
      verifyFile(ICON_FILE)
    ]);

    if (!hasIndex || !hasManifest || !hasIcon) {
      readyState = { ready: false, reason: 'required-files-missing' };
      return readyState;
    }

    readyState = { ready: true, reason: 'static-assets-verified' };
    return readyState;
  } catch (error) {
    readyState = {
      ready: false,
      reason: 'dist-check-failed',
      error: error instanceof Error ? error.message : String(error)
    };
    return readyState;
  }
}

function resolveAssetPath(requestPath) {
  const normalized = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const decoded = decodeURIComponent(normalized);
  const candidate = path.resolve(DIST_DIR, `.${decoded}`);

  if (!candidate.startsWith(DIST_DIR)) {
    return null;
  }

  return candidate;
}

async function streamFile(res, filePath, statusCode = 200, sendBody = true) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.statusCode = statusCode;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', info.size);

    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    if (!sendBody) {
      res.end();
      return true;
    }

    await new Promise((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });

    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const start = process.hrtime.bigint();

  try {
    const method = req.method || 'GET';
    const host = req.headers.host || '';
    const url = new URL(req.url || '/', `http://${host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/health/live') {
      sendJson(req, res, 200, formatHealth('live'));
      return;
    }

    if (pathname === '/health/ready') {
      const state = await refreshReadyState();
      const statusCode = state.ready ? 200 : 503;
      sendJson(req, res, statusCode, {
        ...formatHealth(state.ready ? 'ready' : 'not_ready'),
        ready: state.ready,
        reason: state.reason
      });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end('Method Not Allowed');
      return;
    }

    if (pathname === '/favicon.ico') {
      const served = await streamFile(res, ICON_FILE, 200, method !== 'HEAD');
      if (served) {
        return;
      }
    }

    const directFilePath = resolveAssetPath(pathname);
    if (directFilePath) {
      const served = await streamFile(res, directFilePath, 200, method !== 'HEAD');
      if (served) {
        return;
      }
    }

    const servedIndex = await streamFile(res, INDEX_FILE, 200, method !== 'HEAD');
    if (servedIndex) {
      return;
    }

    res.statusCode = 503;
    sendJson(req, res, 503, {
      ...formatHealth('not_ready'),
      ready: false,
      reason: 'index-not-available'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('error', 'request_handler_failed', {
      error: errorMessage,
      method: req.method,
      path: req.url
    });

    if (!res.headersSent) {
      sendJson(req, res, 500, { error: 'internal_server_error' });
      return;
    }

    res.end();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (res.statusCode >= 500) {
      log('error', 'request_completed_with_server_error', {
        method: req.method,
        path: req.url,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100
      });
    }
  }
});

server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.maxRequestsPerSocket = parseInt(process.env.SERVER_MAX_REQUESTS_PER_SOCKET || '1000', 10);

let diagnosticsTimer = null;
if (DIAGNOSTICS_ENABLED) {
  diagnosticsTimer = setInterval(() => {
    const memory = process.memoryUsage();
    log('info', 'runtime_diagnostics', {
      uptimeSec: Math.round(process.uptime()),
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      eventLoopLagP95Ms: Math.round(eventLoop.percentile(95) / 1e6),
      eventLoopLagMaxMs: Math.round(eventLoop.max / 1e6)
    });

    eventLoop.reset();
  }, DIAGNOSTICS_INTERVAL_MS);

  diagnosticsTimer.unref();
}

function clearDiagnostics() {
  if (diagnosticsTimer) {
    clearInterval(diagnosticsTimer);
    diagnosticsTimer = null;
  }
}

async function shutdown(signal) {
  log('warn', 'shutdown_signal_received', { signal });
  clearDiagnostics();

  const forceTimer = setTimeout(() => {
    log('fatal', 'shutdown_force_exit', { signal, graceMs: SHUTDOWN_GRACE_MS });
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);

  forceTimer.unref();

  server.close((error) => {
    clearTimeout(forceTimer);

    if (error) {
      log('error', 'server_close_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
      return;
    }

    log('info', 'server_closed', { signal });
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  log('fatal', 'uncaught_exception', {
    error: error?.message,
    stack: error?.stack
  });

  setImmediate(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason) => {
  log('error', 'unhandled_rejection', {
    reason: reason instanceof Error ? reason.message : String(reason)
  });
});

(async () => {
  const state = await refreshReadyState();

  if (!state.ready) {
    log('fatal', 'startup_readiness_failed', state);
    process.exit(1);
    return;
  }

  server.listen(PORT, HOST, () => {
    log('info', 'frontend_static_server_started', {
      host: HOST,
      port: PORT,
      distDir: DIST_DIR,
      keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
      headersTimeoutMs: HEADERS_TIMEOUT_MS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      diagnosticsEnabled: DIAGNOSTICS_ENABLED,
      diagnosticsIntervalMs: DIAGNOSTICS_INTERVAL_MS,
      version: VERSION,
      commit: COMMIT
    });
  });
})();
