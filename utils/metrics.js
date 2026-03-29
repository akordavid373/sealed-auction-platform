class ApplicationMetrics {
  constructor() {
    this.startedAt = new Date();
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.inFlightRequests = 0;
    this.methodCounts = {};
    this.statusCodeCounts = {};
    this.routeStats = new Map();
  }

  incrementInFlight() {
    this.inFlightRequests += 1;
  }

  decrementInFlight() {
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
  }

  recordRequest(req, res, durationMs) {
    const method = req.method || 'UNKNOWN';
    const statusCode = res.statusCode || 0;
    const routePath = req.route && req.route.path ? req.route.path : req.path || req.originalUrl || 'unknown';
    const routeKey = `${method} ${routePath}`;

    this.totalRequests += 1;
    if (statusCode >= 500) {
      this.totalErrors += 1;
    }

    this.methodCounts[method] = (this.methodCounts[method] || 0) + 1;
    this.statusCodeCounts[statusCode] = (this.statusCodeCounts[statusCode] || 0) + 1;

    const existing = this.routeStats.get(routeKey) || {
      count: 0,
      totalDurationMs: 0,
      minDurationMs: Number.POSITIVE_INFINITY,
      maxDurationMs: 0,
      lastStatusCode: 0,
      lastDurationMs: 0,
      lastSeenAt: null
    };

    existing.count += 1;
    existing.totalDurationMs += durationMs;
    existing.minDurationMs = Math.min(existing.minDurationMs, durationMs);
    existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
    existing.lastStatusCode = statusCode;
    existing.lastDurationMs = durationMs;
    existing.lastSeenAt = new Date().toISOString();

    this.routeStats.set(routeKey, existing);
  }

  getSnapshot() {
    const uptimeSeconds = process.uptime();
    const processMemory = process.memoryUsage();

    const routes = Array.from(this.routeStats.entries())
      .sort((left, right) => right[1].count - left[1].count)
      .map(([route, stats]) => ({
        route,
        count: stats.count,
        avgDurationMs: Number((stats.totalDurationMs / stats.count).toFixed(2)),
        minDurationMs: Number(stats.minDurationMs.toFixed(2)),
        maxDurationMs: Number(stats.maxDurationMs.toFixed(2)),
        lastStatusCode: stats.lastStatusCode,
        lastDurationMs: Number(stats.lastDurationMs.toFixed(2)),
        lastSeenAt: stats.lastSeenAt
      }));

    return {
      timestamp: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Number(uptimeSeconds.toFixed(2)),
      requests: {
        total: this.totalRequests,
        inFlight: this.inFlightRequests,
        errors5xx: this.totalErrors,
        errorRate: this.totalRequests > 0
          ? Number(((this.totalErrors / this.totalRequests) * 100).toFixed(2))
          : 0,
        averageRpsSinceStart: uptimeSeconds > 0
          ? Number((this.totalRequests / uptimeSeconds).toFixed(4))
          : 0,
        byMethod: this.methodCounts,
        byStatusCode: this.statusCodeCounts
      },
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        memory: {
          rssBytes: processMemory.rss,
          heapTotalBytes: processMemory.heapTotal,
          heapUsedBytes: processMemory.heapUsed,
          externalBytes: processMemory.external,
          arrayBuffersBytes: processMemory.arrayBuffers
        }
      },
      routes
    };
  }

  toPrometheus() {
    const lines = [];
    const snapshot = this.getSnapshot();

    lines.push('# HELP app_requests_total Total number of HTTP requests');
    lines.push('# TYPE app_requests_total counter');
    lines.push(`app_requests_total ${snapshot.requests.total}`);

    lines.push('# HELP app_requests_in_flight Number of in-flight HTTP requests');
    lines.push('# TYPE app_requests_in_flight gauge');
    lines.push(`app_requests_in_flight ${snapshot.requests.inFlight}`);

    lines.push('# HELP app_request_errors_total Total number of HTTP 5xx responses');
    lines.push('# TYPE app_request_errors_total counter');
    lines.push(`app_request_errors_total ${snapshot.requests.errors5xx}`);

    lines.push('# HELP app_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE app_uptime_seconds gauge');
    lines.push(`app_uptime_seconds ${snapshot.uptimeSeconds}`);

    lines.push('# HELP app_memory_rss_bytes Resident set size memory in bytes');
    lines.push('# TYPE app_memory_rss_bytes gauge');
    lines.push(`app_memory_rss_bytes ${snapshot.process.memory.rssBytes}`);

    Object.entries(snapshot.requests.byMethod).forEach(([method, count]) => {
      lines.push(`app_requests_by_method_total{method="${method}"} ${count}`);
    });

    Object.entries(snapshot.requests.byStatusCode).forEach(([statusCode, count]) => {
      lines.push(`app_requests_by_status_total{status_code="${statusCode}"} ${count}`);
    });

    snapshot.routes.forEach((route) => {
      const safeRoute = route.route
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');

      lines.push(`app_route_requests_total{route="${safeRoute}"} ${route.count}`);
      lines.push(`app_route_avg_duration_ms{route="${safeRoute}"} ${route.avgDurationMs}`);
      lines.push(`app_route_max_duration_ms{route="${safeRoute}"} ${route.maxDurationMs}`);
    });

    return `${lines.join('\n')}\n`;
  }
}

function createMetricsMiddleware(metrics) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    let recorded = false;

    metrics.incrementInFlight();

    const recordMetrics = () => {
      if (recorded) {
        return;
      }

      recorded = true;
      const elapsedNs = process.hrtime.bigint() - start;
      const durationMs = Number(elapsedNs) / 1e6;

      metrics.decrementInFlight();
      metrics.recordRequest(req, res, durationMs);
    };

    res.once('finish', recordMetrics);
    res.once('close', recordMetrics);

    next();
  };
}

module.exports = {
  ApplicationMetrics,
  createMetricsMiddleware
};
