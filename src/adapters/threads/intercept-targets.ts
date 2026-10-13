import type { InterceptTarget } from '@/adapters/types';

const PATHS = ['/graphql/query', '/api/graphql'];

/** Không import gì khác: được bundle vào interceptor (MAIN world). */
export const THREADS_INTERCEPT_TARGETS: InterceptTarget[] = [
  { hostSuffix: 'threads.com', pathPrefixes: PATHS },
  { hostSuffix: 'threads.net', pathPrefixes: PATHS },
];
