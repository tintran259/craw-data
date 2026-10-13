import { describe, expect, it } from 'vitest';
import { FACEBOOK_INTERCEPT_TARGETS } from '@/adapters/facebook/intercept-targets';
import { describeFormGraphql, targetMatcher } from './request';

describe('targetMatcher', () => {
  const isFacebookGraphql = targetMatcher(FACEBOOK_INTERCEPT_TARGETS);
  it('nhận endpoint GraphQL', () => {
    expect(isFacebookGraphql('https://www.facebook.com/api/graphql/')).toBe(true);
    expect(isFacebookGraphql('https://web.facebook.com/api/graphql/')).toBe(true);
  });
  it('bỏ qua endpoint khác', () => {
    expect(isFacebookGraphql('https://www.facebook.com/ajax/bz')).toBe(false);
    expect(isFacebookGraphql('https://evil.com/api/graphql/')).toBe(false);
    expect(isFacebookGraphql('not a url')).toBe(false);
  });
});

describe('describeFormGraphql', () => {
  it('chỉ lấy tên operation, doc_id, variables — không lấy token', () => {
    const body = new URLSearchParams({
      av: '1000',
      __user: '1000',
      fb_dtsg: 'SECRET',
      lsd: 'SECRET2',
      fb_api_req_friendly_name: 'CommentListComponentsRootQuery',
      variables: '{"id":"abc"}',
      doc_id: '42',
    }).toString();
    const info = describeFormGraphql('https://www.facebook.com/api/graphql/', body);
    expect(info).toEqual({
      operationName: 'CommentListComponentsRootQuery',
      docId: '42',
      variables: '{"id":"abc"}',
    });
    expect(JSON.stringify(info)).not.toContain('SECRET');
  });
  it('không có body (REST): lấy tên từ đường dẫn', () => {
    expect(describeFormGraphql('https://www.instagram.com/api/v1/media/1/comments/')).toEqual({
      operationName: '/api/v1/media/1/comments/',
      docId: null,
      variables: null,
    });
  });
});
