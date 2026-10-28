const { HttpError } = require('./policy.cjs');

// Compteurs bornés, par processus. Ne jamais faire confiance à X-Forwarded-For.
function createRateLimiter({ now = Date.now, windowMs = 60000, maxKeys = 2048 } = {}) {
  const buckets = new Map();
  return function limit(request, group, perAddress, total) {
    const time = now();
    for (const [key, bucket] of buckets) if (bucket.until <= time) buckets.delete(key);
    const keys = [[`${group}:global`, total], [`${group}:${request.socket.remoteAddress || 'unknown'}`, perAddress]];
    if (buckets.size + keys.filter(([key]) => !buckets.has(key)).length > maxKeys) {
      const error = new HttpError(429, 'RATE_LIMITED'); error.retryAfter = Math.ceil(windowMs / 1000); throw error;
    }
    for (const [key, maximum] of keys) {
      const bucket = buckets.get(key);
      if ((bucket && bucket.count >= maximum) || (!bucket && buckets.size >= maxKeys)) {
        const error = new HttpError(429, 'RATE_LIMITED');
        error.retryAfter = Math.max(1, Math.ceil(((bucket?.until || time + windowMs) - time) / 1000));
        throw error;
      }
    }
    for (const [key] of keys) {
      const bucket = buckets.get(key) || { count: 0, until: time + windowMs };
      bucket.count++;
      buckets.set(key, bucket);
    }
  };
}
module.exports = { createRateLimiter };
