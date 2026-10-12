import { describe, expect, it } from 'vitest';
import { describeFacebookRequest, isFacebookGraphqlRequest } from './request';

describe('isFacebookGraphqlRequest', () => {
  it('nhận endpoint GraphQL', () => {
    expect(isFacebookGraphqlRequest('https://www.facebook.com/api/graphql/')).toBe(true);
  });
  it('bỏ qua endpoint khác', () => {
    expect(isFacebookGraphqlRequest('https://www.facebook.com/ajax/bz')).toBe(false);
    expect(isFacebookGraphqlRequest('https://evil.com/api/graphql/')).toBe(false);
  });
});

describe('describeFacebookRequest', () => {
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
    const info = describeFacebookRequest('https://www.facebook.com/api/graphql/', body);
    expect(info).toEqual({
      operationName: 'CommentListComponentsRootQuery',
      docId: '42',
      variables: '{"id":"abc"}',
    });
    expect(JSON.stringify(info)).not.toContain('SECRET');
  });
  it('trả về null khi không có body', () => {
    expect(describeFacebookRequest('x')).toEqual({
      operationName: null,
      docId: null,
      variables: null,
    });
  });
});
