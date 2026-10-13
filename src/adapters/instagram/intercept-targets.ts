import type { InterceptTarget } from '@/adapters/types';

/** Không import gì khác: được bundle vào interceptor (MAIN world). */
export const INSTAGRAM_INTERCEPT_TARGETS: InterceptTarget[] = [
  {
    hostSuffix: 'instagram.com',
    pathPrefixes: ['/graphql/query', '/api/graphql', '/api/v1/media/'],
  },
];
