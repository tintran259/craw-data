type Level = 'debug' | 'info' | 'warn' | 'error';

/** Logger có tiền tố; chỉ ghi ra console của extension, không gửi đi đâu. */
export function createLogger(scope: string) {
  const prefix = `[SCE:${scope}]`;
  const write =
    (level: Level) =>
    (...args: unknown[]) => {
      console[level](prefix, ...args);
    };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
