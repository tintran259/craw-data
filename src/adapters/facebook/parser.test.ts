import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeComments } from '@/core/dedupe';
import type { CommentRecord, ParseContext } from '@/adapters/types';
import { facebookInitialHtmlTotalCount, parseFacebookInitialHtml } from './initial-html';
import { decodeFbObjectId, extractFacebookTotalCount, parseFacebookPayload } from './parser';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const ctx: ParseContext = {
  postUrl: 'https://www.facebook.com/share/p/1E7cjaRqJ3/',
  crawledAt: '2026-10-12T15:00:00.000Z',
};

describe('decodeFbObjectId', () => {
  it('giải mã id base64 thật', () => {
    expect(
      decodeFbObjectId('Y29tbWVudDoxNTkzNzk1OTc5NDQ4MDYyXzE1ODMzNzg5MzM1OTMwNDg=', 'comment'),
    ).toBe('1583378933593048');
    expect(decodeFbObjectId('ZmVlZGJhY2s6MTU5Mzc5NTk3OTQ0ODA2Mg==', 'feedback')).toBeNull(); // feedback của bài
    expect(decodeFbObjectId('not base64 !!', 'comment')).toBeNull();
  });
});

describe('parseFacebookPayload — JSON nhúng HTML thật (bài Page)', () => {
  const raw = fixture('initial-html-page-post.real.json');
  const records = parseFacebookPayload(raw, ctx);

  it('lấy đủ 10 comment gốc của lô đầu, không trùng', () => {
    expect(records).toHaveLength(10);
    expect(new Set(records.map((r) => r.commentId)).size).toBe(10);
    expect(records.every((r) => r.depth === 0 && r.parentId === null)).toBe(true);
  });

  it('map đúng các trường', () => {
    const c = records.find((r) => r.commentId === '1531517308377452');
    expect(c).toEqual<CommentRecord>({
      postUrl: ctx.postUrl,
      platform: 'facebook',
      commentId: '1531517308377452',
      parentId: null,
      depth: 0,
      authorName: 'Thân Tấn Lộc',
      authorId: '100028292912897',
      authorProfileUrl: 'https://www.facebook.com/loc.than.948',
      content: 'Cái đoạn mà ban đêm bả thò  đầu ra kêu “ối dồi ôi” á 🤣🤣',
      attachmentUrls: [],
      reactionCount: 65,
      replyCount: 1,
      createdAt: new Date(1791439231 * 1000).toISOString(),
      crawledAt: ctx.crawledAt,
    });
  });

  it('giữ xuống dòng trong nội dung', () => {
    const c = records.find((r) => r.commentId === '1583378933593048');
    expect(c?.content).toContain('\n\nTheo Phụ nữ');
    expect(c?.reactionCount).toBe(16);
    // Ảnh xem trước của link chia sẻ không tính là ảnh đính kèm.
    expect(c?.attachmentUrls).toEqual([]);
  });

  it('lấy ảnh đính kèm', () => {
    const withPhotos = records.filter((r) => r.attachmentUrls.length > 0);
    expect(withPhotos.map((r) => r.commentId).sort()).toEqual([
      '1303286679542433',
      '2339066036856726',
    ]);
    expect(withPhotos[0]?.attachmentUrls[0]).toMatch(/^https:\/\/scontent/);
  });

  it('đọc tổng số bình luận Facebook báo', () => {
    expect(extractFacebookTotalCount(raw)).toBe(248);
  });

  it('parseInitialHtml đọc từ thẻ script', () => {
    const doc = document.implementation.createHTMLDocument('x');
    const script = doc.createElement('script');
    script.type = 'application/json';
    script.textContent = raw;
    doc.body.append(script);
    expect(parseFacebookInitialHtml(doc, ctx)).toHaveLength(10);
    expect(facebookInitialHtmlTotalCount(doc, extractFacebookTotalCount)).toBe(248);
  });
});

describe('parseFacebookPayload — response GraphQL (mẫu tổng hợp)', () => {
  it('xử lý for (;;); + nhiều dòng, reply lồng trong comment cha', () => {
    const records = parseFacebookPayload(fixture('pagination.synthetic.txt'), ctx);
    expect(records.map((r) => [r.commentId, r.parentId, r.depth])).toEqual([
      ['9001', null, 0],
      ['9002', '9001', 1],
    ]);
    expect(records[1]?.content).toBe('Trả lời 👍\nDòng 2');
    expect(records[0]?.reactionCount).toBe(3);
  });

  it('suy ra comment cha từ variables của request khi response thiếu', () => {
    const records = parseFacebookPayload(fixture('replies.synthetic.txt'), {
      ...ctx,
      requestVariables: '{"id":"ZmVlZGJhY2s6MTU5Mzc5NTk3OTQ0ODA2Ml85MDAx","first":10}',
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ commentId: '9003', parentId: '9001', depth: 1 });
  });

  it('khử trùng lặp khi cùng comment xuất hiện ở nhiều response', () => {
    const map = new Map<string, CommentRecord>();
    mergeComments(map, parseFacebookPayload(fixture('pagination.synthetic.txt'), ctx));
    mergeComments(map, parseFacebookPayload(fixture('pagination.synthetic.txt'), ctx));
    expect(map.size).toBe(2);
  });

  it('bỏ qua payload không liên quan', () => {
    expect(parseFacebookPayload('{"data":{"viewer":{"id":"1"}}}', ctx)).toEqual([]);
    expect(parseFacebookPayload('not json "Comment"', ctx)).toEqual([]);
  });
});
