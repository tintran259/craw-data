import type { InterceptTarget } from '@/adapters/types';

const PATHS = ['/i/api/graphql/'];

/** Không import gì khác: được bundle vào interceptor (MAIN world). */
export const X_INTERCEPT_TARGETS: InterceptTarget[] = [
  { hostSuffix: 'x.com', pathPrefixes: PATHS },
  { hostSuffix: 'twitter.com', pathPrefixes: PATHS },
];
