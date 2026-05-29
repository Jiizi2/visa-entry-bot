export function normalizeDurationMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

export function memberScanTotalMs(member) {
  const metrics = member?.processingMetrics;
  if (!metrics || typeof metrics !== "object") {
    return 0;
  }
  return normalizeDurationMs(metrics.totalMs);
}

export function scanTimingSummary({
  scanPerfSummary = null,
  lastScanMetric = null,
  scanMetricRecords = [],
  members = [],
} = {}) {
  const summary = scanTimingSummaryFromPerformance(scanPerfSummary);
  const latest = lastScanMetric || latestScanMetricFromMembers(members);
  if (summary.filesWithMetrics > 0) {
    return { ...summary, latest };
  }

  const liveSummary = scanTimingSummaryFromValues(
    scanMetricRecords.map((entry) => entry.totalMs),
  );
  if (liveSummary.filesWithMetrics > 0) {
    return { ...liveSummary, latest };
  }

  return { ...scanTimingSummaryFromValues(members.map(memberScanTotalMs)), latest };
}

export function scanTimingSummaryFromPerformance(summary) {
  if (!summary || typeof summary !== "object") {
    return emptyScanTimingSummary();
  }

  const filesWithMetrics = normalizeDurationMs(summary.filesWithMetrics);
  const avgTotalMs = normalizeDurationMs(summary.avgTotalMs);
  if (filesWithMetrics <= 0 || avgTotalMs <= 0) {
    return emptyScanTimingSummary();
  }

  return {
    filesWithMetrics,
    avgTotalMs,
    p95TotalMs: normalizeDurationMs(summary.p95TotalMs),
    maxTotalMs: normalizeDurationMs(summary.maxTotalMs),
  };
}

export function scanTimingSummaryFromValues(values) {
  const durations = values
    .map(normalizeDurationMs)
    .filter((value) => value > 0);
  if (!durations.length) {
    return emptyScanTimingSummary();
  }

  const sorted = [...durations].sort((left, right) => left - right);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    filesWithMetrics: durations.length,
    avgTotalMs: Math.round(total / durations.length),
    p95TotalMs: sorted[p95Index],
    maxTotalMs: sorted[sorted.length - 1],
  };
}

export function emptyScanTimingSummary() {
  return {
    filesWithMetrics: 0,
    avgTotalMs: 0,
    p95TotalMs: 0,
    maxTotalMs: 0,
  };
}

export function latestScanMetricFromMembers(members) {
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const totalMs = memberScanTotalMs(members[index]);
    if (totalMs > 0) {
      return {
        fileName: String(members[index].fileName || ""),
        totalMs,
        metrics: members[index].processingMetrics,
      };
    }
  }
  return null;
}
