import type { InterceptTarget } from '@/adapters/types';

export const FACEBOOK_INTERCEPT_TARGETS: InterceptTarget[] = [
  { hostSuffix: 'facebook.com', pathPrefixes: ['/api/graphql/'] },
];
