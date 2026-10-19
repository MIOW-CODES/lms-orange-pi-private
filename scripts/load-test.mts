#!/usr/bin/env bun
/*
 * Simple concurrency / load test for MIOW-LMS.
 *
 * Fires a fixed number of requests at a path with a bounded concurrency and
 * reports latency percentiles + error rate. Useful for the "48 students at once"
 * question — point it at a production-like build and, for authenticated routes,
 * pass a session token.
 *
 * Usage:
 *   bun scripts/load-test.mts --url http://127.0.0.1:3000 --path /auth --concurrency 48 --requests 480
 *   bun scripts/load-test.mts --url https://... --path /dashboard/student/quizzes \
 *       --concurrency 48 --requests 480 --token "$SESSION_TOKEN"
 *
 * Notes:
 *   - For DB-backed routes, first provision an operator-approved local PostgreSQL dataset.
 *   - Avoid write traffic against any production deployment.
 */

interface Options {
  url: string;
  path: string;
  concurrency: number;
  requests: number;
  token?: string;
  method: string;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback?: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    return idx >= 0 ? argv[idx + 1] : fallback;
  };
  const url = get("url", "http://127.0.0.1:3000")!;
  const path = get("path", "/auth")!;
  const concurrency = Number(get("concurrency", "48"));
  const requests = Number(get("requests", String(concurrency * 10)));
  const token = get("token");
  const method = (get("method", "GET") ?? "GET").toUpperCase();
  return { url, path, concurrency, requests, token, method };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = new URL(opts.path, opts.url).toString();
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  console.log(
    `Load test → ${opts.method} ${target}\n` +
      `  concurrency=${opts.concurrency} requests=${opts.requests}\n`,
  );

  const latencies: number[] = [];
  let ok = 0;
  let failed = 0;
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= opts.requests) return;
      const start = performance.now();
      try {
        const res = await fetch(target, { method: opts.method, headers });
        // Drain the body so the connection is reusable.
        await res.arrayBuffer();
        const ms = performance.now() - start;
        latencies.push(ms);
        if (res.status >= 200 && res.status < 400) ok++;
        else failed++;
      } catch {
        const ms = performance.now() - start;
        latencies.push(ms);
        failed++;
      }
    }
  };

  const wallStart = performance.now();
  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  const wallMs = performance.now() - wallStart;

  latencies.sort((a, b) => a - b);
  const total = ok + failed;
  const rps = total / (wallMs / 1000);
  const summary = {
    requests: total,
    ok,
    failed,
    error_rate: `${((failed / Math.max(1, total)) * 100).toFixed(2)}%`,
    wall_ms: Math.round(wallMs),
    throughput_rps: Number(rps.toFixed(1)),
    latency_ms: {
      min: Math.round(latencies[0] ?? 0),
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      p99: Math.round(percentile(latencies, 99)),
      max: Math.round(latencies[latencies.length - 1] ?? 0),
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  // Non-zero exit when the run is clearly unhealthy, so CI can gate on it.
  if (failed > 0 && failed / total > 0.05) process.exit(1);
}

await main();
