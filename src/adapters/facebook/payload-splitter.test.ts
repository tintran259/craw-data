import { describe, expect, it } from 'vitest';
import { splitJsonPayload } from './payload-splitter';

describe('splitJsonPayload', () => {
  it('bỏ tiền tố for (;;);', () => {
    expect(splitJsonPayload('for (;;);{"a":1}')).toEqual([{ a: 1 }]);
  });

  it('tách nhiều object theo dòng', () => {
    expect(splitJsonPayload('{"a":1}\n{"b":2}\n\n{"c":3}\n')).toEqual([
      { a: 1 },
      { b: 2 },
      { c: 3 },
    ]);
  });

  it('tách object dính liền, kể cả ngoặc nằm trong chuỗi', () => {
    expect(splitJsonPayload('for (;;);{"a":"}{\\""}{"b":[1,{"c":"]"}]}')).toEqual([
      { a: '}{"' },
      { b: [1, { c: ']' }] },
    ]);
  });

  it('bỏ qua phần hỏng, giữ phần tốt', () => {
    expect(splitJsonPayload('{"a":1}\n{"broken"}\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('giữ nguyên emoji và xuống dòng', () => {
    expect(splitJsonPayload('{"t":"hi 😀\\nline2"}')).toEqual([{ t: 'hi 😀\nline2' }]);
  });
});
