import assert from "node:assert/strict";
import test from "node:test";

import {
  latestScanMetricFromMembers,
  memberScanTotalMs,
  scanTimingSummary,
  scanTimingSummaryFromPerformance,
  scanTimingSummaryFromValues,
} from "../src/shared/metrics.js";

test("memberScanTotalMs normalizes processing duration", () => {
  assert.equal(memberScanTotalMs({ processingMetrics: { totalMs: 1200.6 } }), 1201);
  assert.equal(memberScanTotalMs({ processingMetrics: { totalMs: -10 } }), 0);
  assert.equal(memberScanTotalMs({}), 0);
});

test("scanTimingSummaryFromValues computes average p95 and max", () => {
  assert.deepEqual(scanTimingSummaryFromValues([100, 200, 300]), {
    filesWithMetrics: 3,
    avgTotalMs: 200,
    p95TotalMs: 300,
    maxTotalMs: 300,
  });
});

test("scanTimingSummaryFromPerformance accepts valid worker summary", () => {
  assert.deepEqual(scanTimingSummaryFromPerformance({
    filesWithMetrics: 2,
    avgTotalMs: 150.4,
    p95TotalMs: 200,
    maxTotalMs: 220,
  }), {
    filesWithMetrics: 2,
    avgTotalMs: 150,
    p95TotalMs: 200,
    maxTotalMs: 220,
  });
});

test("scanTimingSummary prefers performance summary then live records then manifest metrics", () => {
  assert.equal(scanTimingSummary({
    scanPerfSummary: { filesWithMetrics: 2, avgTotalMs: 500 },
    scanMetricRecords: [{ totalMs: 100 }],
    members: [{ processingMetrics: { totalMs: 50 } }],
  }).avgTotalMs, 500);

  assert.equal(scanTimingSummary({
    scanMetricRecords: [{ totalMs: 100 }, { totalMs: 300 }],
    members: [{ processingMetrics: { totalMs: 50 } }],
  }).avgTotalMs, 200);

  assert.equal(scanTimingSummary({
    members: [{ processingMetrics: { totalMs: 50 } }, { processingMetrics: { totalMs: 150 } }],
  }).avgTotalMs, 100);
});

test("latestScanMetricFromMembers returns the last member with metrics", () => {
  assert.deepEqual(latestScanMetricFromMembers([
    { fileName: "a.jpg", processingMetrics: { totalMs: 100 } },
    { fileName: "b.jpg", processingMetrics: { totalMs: 0 } },
    { fileName: "c.jpg", processingMetrics: { totalMs: 200 } },
  ]), {
    fileName: "c.jpg",
    totalMs: 200,
    metrics: { totalMs: 200 },
  });
});
