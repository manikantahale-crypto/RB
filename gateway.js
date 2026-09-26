const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Public Render PORT (assigned dynamically by Render in production, default 8080 locally)
const PORT = process.env.PORT || 8080;

// Internal service targets (configured via env or local defaults)
const SYNTRA_PORT = process.env.SYNTRA_PORT || 4000;
const ORCH_PORT = process.env.API_PORT || 4100;
const ADMIN_PORT = process.env.ADMIN_API_PORT || 4200;

const SYNTRA_TARGET = process.env.SYNTRA_TARGET || `http://127.0.0.1:${SYNTRA_PORT}`;
const ORCH_TARGET = process.env.ORCH_TARGET || `http://127.0.0.1:${ORCH_PORT}`;
const ADMIN_TARGET = process.env.ADMIN_TARGET || `http://127.0.0.1:${ADMIN_PORT}`;

// 1. Configurable CORS:
// Support FRONTEND_URL, ALLOWED_ORIGINS, local development, and Vercel preview/production domains.
// Do not allow arbitrary origins.
const configuredOrigins = (process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

const isOriginAllowed = (origin) => {
  // Allow non-browser / direct server-to-server / healthcheck requests
  if (!origin) return true;

  // Exact match against configured frontend URLs
  if (configuredOrigins.includes(origin)) return true;

  // Local development (localhost / 127.0.0.1 with any port)
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;

  // Vercel deployment preview / production domains (*.vercel.app)
  if (/^https:\/\/[a-zA-Z0-9_.-]+\.vercel\.app$/.test(origin)) return true;

  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-Id',
    'X-Correlation-Id',
    'X-Requested-With',
    'Accept',
    'Origin',
  ],
  exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
};

app.use(cors(corsOptions));

const isDebug =
  process.env.DEBUG_MODE === 'true' ||
  process.env.DEBUG_MODE === '1' ||
  process.env.DEBUG === 'true';

// Request correlation ID and optional debug request logging
app.use((req, res, next) => {
  const incomingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const requestId =
    typeof incomingId === 'string' && incomingId.trim()
      ? incomingId.trim()
      : `gw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  req.id = requestId;
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  if (isDebug) {
    const start = Date.now();
    console.log(`[GW DEBUG] [request=${requestId}] ${req.method} ${req.originalUrl}`);
    res.on('finish', () => {
      console.log(
        `[GW DEBUG] [request=${requestId}] ${req.method} ${req.originalUrl} ← ${res.statusCode} duration=${Date.now() - start}ms`
      );
    });
  }
  next();
});

// 2. Gateway Deep Readiness Healthcheck:
// Checks all internal services concurrently with a short timeout.
// Returns 200 only when Node API, Orchestrator, and Admin API are all ready.
// Returns 503 while any service is initializing or unreachable.
const checkServiceHealth = async (url, timeoutMs = 2000) => {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
};

app.get('/healthz', async (req, res) => {
  try {
    const [syntraOk, orchOk, adminOk] = await Promise.all([
      checkServiceHealth(`${SYNTRA_TARGET}/health`),
      checkServiceHealth(`${ORCH_TARGET}/health`),
      checkServiceHealth(`${ADMIN_TARGET}/health`),
    ]);

    if (syntraOk && orchOk && adminOk) {
      return res.status(200).json({
        ok: true,
        status: 'ready',
      });
    }

    if (isDebug) {
      console.warn(
        `[GATEWAY READINESS] Initializing: syntra=${syntraOk}, orch=${orchOk}, admin=${adminOk}`
      );
    }

    return res.status(503).json({
      ok: false,
      status: 'initializing',
    });
  } catch (err) {
    if (isDebug) {
      console.error('[GATEWAY READINESS ERROR]', err.message);
    }
    return res.status(503).json({
      ok: false,
      status: 'initializing',
    });
  }
});

// 3 & 4. Proxy Error Handling & Timeouts:
// Streams are kept intact (no express.json() called globally) so multipart uploads stream directly.
const createServiceProxy = (target, options = {}) => {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    proxyTimeout: 120000, // 2 minutes
    timeout: 120000,
    on: {
      proxyReq: (proxyReq, req, res) => {
        if (req.id) {
          proxyReq.setHeader('x-request-id', req.id);
        }
        if (isDebug) {
          const authHeader = req.headers['authorization'] || '';
          const authPresent = Boolean(authHeader);
          const tokenType = authHeader ? authHeader.split(' ')[0] : 'None';
          const cookiePresent = Boolean(req.headers['cookie']);
          console.log(
            `[GW DEBUG] [request=${req.id}] ${req.method} ${req.originalUrl} → ${target}${proxyReq.path} authPresent=${authPresent} tokenType=${tokenType} cookiePresent=${cookiePresent}`
          );
        }
      },
      proxyRes: (proxyRes, req, res) => {
        if (isDebug && proxyRes.statusCode >= 400) {
          console.warn(
            `[GW DEBUG] [request=${req.id}] Upstream ${target} returned ${proxyRes.statusCode} for ${req.method} ${req.originalUrl}`
          );
        }
      },
      error: (err, req, res) => {
        console.error(
          `[GATEWAY PROXY ERROR] [request=${req?.id || 'unknown'}] ${req?.method} ${req?.originalUrl || req?.url} -> ${target}:`,
          err.message
        );
        if (res.writeHead && !res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'service_unavailable',
              message: 'Downstream internal service is temporarily unavailable or initializing.',
              code: err.code || 'ECONNREFUSED',
              requestId: req?.id || null,
            })
          );
        }
      },
    },
    ...options,
  });
};

// Route 1: /v1/* -> Orchestration Ingress API (:4100)
// Preserves the /v1 prefix expected by orchestration API endpoints
app.use(
  '/v1',
  createServiceProxy(ORCH_TARGET, {
    pathRewrite: (path) => '/v1' + (path.startsWith('/') ? path : '/' + path),
  })
);

// Route 2: /admin-api/* -> Admin Authoring API (:4200)
// Strips /admin-api prefix so /admin-api/health -> /health, /admin-api/catalog -> /catalog
app.use(
  '/admin-api',
  createServiceProxy(ADMIN_TARGET, {
    pathRewrite: { '^/admin-api': '' },
  })
);

// Route 3: /* -> Syntra / Node API (:4000)
// Catch-all route preserving /auth/*, /health, /jobs/*, /candidates/*, /submissions/*, /placements/*, /api/relay/*, etc.
app.use(
  '/',
  createServiceProxy(SYNTRA_TARGET)
);

// Start Gateway
const server = app.listen(PORT, () => {
  console.log(`[GATEWAY] API Gateway listening on port ${PORT}`);
  console.log(`[GATEWAY] Routing /healthz         -> Gateway internal health`);
  console.log(`[GATEWAY] Routing /v1/*            -> Orchestration API (${ORCH_TARGET})`);
  console.log(`[GATEWAY] Routing /admin-api/*     -> Admin API (${ADMIN_TARGET}, prefix stripped)`);
  console.log(`[GATEWAY] Routing /*               -> Syntra & In-Process Relay (${SYNTRA_TARGET})`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`[GATEWAY] Received ${signal}, shutting down gateway...`);
  server.close(() => {
    console.log('[GATEWAY] Gateway closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
