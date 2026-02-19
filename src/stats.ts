// stats.ts — Global retry statistics tracker (singleton)
// v0.9.0 FM-9: expose retry counters in daemon health output

interface RetryStats {
  total: number;
  recovered: number;
  failed: number;
  by_type: Record<string, number>;
}

const _stats: RetryStats = {
  total: 0,
  recovered: 0,
  failed: 0,
  by_type: {},
};

/** Called each time withRetry catches an error (one call per retry attempt). */
export function recordRetryAttempt(errorClass: string): void {
  _stats.total++;
  _stats.by_type[errorClass] = (_stats.by_type[errorClass] ?? 0) + 1;
}

/** Called once per withRetry invocation: true = eventually recovered, false = exhausted. */
export function recordRetryOutcome(recovered: boolean): void {
  if (recovered) {
    _stats.recovered++;
  } else {
    _stats.failed++;
  }
}

export function getRetryStats(): RetryStats & { recovery_rate: number } {
  const total = _stats.recovered + _stats.failed;
  return {
    total: _stats.total,
    recovered: _stats.recovered,
    failed: _stats.failed,
    by_type: { ..._stats.by_type },
    recovery_rate: total > 0 ? Math.round((_stats.recovered / total) * 100) : 0,
  };
}

/** Reset all counters — useful for tests. */
export function resetRetryStats(): void {
  _stats.total = 0;
  _stats.recovered = 0;
  _stats.failed = 0;
  _stats.by_type = {};
}
