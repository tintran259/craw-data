const HOUR_MS = 60 * 60 * 1000;

/** Giữ lại các mốc bắt đầu trong 1 giờ gần nhất. */
export function pruneHistory(history: number[], now: number): number[] {
  return history.filter((t) => now - t < HOUR_MS);
}

/**
 * Thời điểm sớm nhất được bắt đầu bài tiếp theo theo giới hạn "số bài tối đa mỗi giờ".
 * Trả về `now` nếu chưa chạm giới hạn.
 */
export function nextAllowedByHourlyLimit(
  history: number[],
  maxPerHour: number,
  now: number,
): number {
  const recent = pruneHistory(history, now).sort((a, b) => a - b);
  if (recent.length < maxPerHour) return now;
  return recent[recent.length - maxPerHour]! + HOUR_MS;
}
