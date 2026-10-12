export interface Range {
  min: number;
  max: number;
}

export function randomBetween({ min, max }: Range): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.round(lo + Math.random() * (hi - lo));
}

export class AbortedError extends Error {
  constructor() {
    super('Đã hủy');
    this.name = 'AbortedError';
  }
}

/** Chờ `ms` mili giây; reject bằng AbortedError nếu signal bị hủy. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function randomSleep(range: Range, signal?: AbortSignal): Promise<void> {
  return sleep(randomBetween(range), signal);
}
