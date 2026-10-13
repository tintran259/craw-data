import { FACEBOOK_INTERCEPT_TARGETS } from './facebook/intercept-targets';
import { INSTAGRAM_INTERCEPT_TARGETS } from './instagram/intercept-targets';
import { THREADS_INTERCEPT_TARGETS } from './threads/intercept-targets';
import type { InterceptTarget } from './types';
import { X_INTERCEPT_TARGETS } from './x/intercept-targets';

/**
 * Endpoint mà interceptor (MAIN world) cần bắt. Tách riêng khỏi registry để bundle interceptor
 * không kéo theo parser. Thêm nền tảng mới: thêm target của nó vào đây.
 */
export const ALL_INTERCEPT_TARGETS: InterceptTarget[] = [
  ...FACEBOOK_INTERCEPT_TARGETS,
  ...INSTAGRAM_INTERCEPT_TARGETS,
  ...THREADS_INTERCEPT_TARGETS,
  ...X_INTERCEPT_TARGETS,
];

export function matchesInterceptTarget(
  url: URL,
  targets: InterceptTarget[] = ALL_INTERCEPT_TARGETS,
): boolean {
  const host = url.hostname.toLowerCase();
  return targets.some(
    (t) =>
      (host === t.hostSuffix || host.endsWith(`.${t.hostSuffix}`)) &&
      t.pathPrefixes.some((p) => url.pathname.startsWith(p)),
  );
}
