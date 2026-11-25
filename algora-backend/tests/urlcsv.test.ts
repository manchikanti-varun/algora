import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/lib/csv';
import { parseLeetCodeUrl } from '../src/lib/leetcodeUrl';

describe('parseLeetCodeUrl', () => {
  it('normalises slug and canonical url', () => {
    expect(parseLeetCodeUrl('https://leetcode.com/problems/Two-Sum/description/?envType=x')).toEqual({ slug: 'two-sum', url: 'https://leetcode.com/problems/two-sum/' });
    expect(parseLeetCodeUrl('https://www.leetcode.com/problems/two-sum').slug).toBe('two-sum');
  });
  it.each([
    'http://leetcode.com/problems/two-sum', 'https://leetcode.com.evil.com/problems/two-sum', 'https://evil.com/problems/two-sum',
    'https://leetcode.com/contest/x', 'https://user@leetcode.com/problems/a', 'javascript:alert(1)', 'not a url', 'https://leetcode.com/problems/',
  ])('rejects %s', (u) => expect(() => parseLeetCodeUrl(u)).toThrow());
});

describe('csv', () => {
  it('parses quotes, CRLF, BOM and normalises headers', () => {
    const rows = parseCsv('\uFEFFRoll Number,Email\r\nAB12CD34EF,"a,b@x.com"\r\n\r\nXY12CD34EF,\r\n');
    expect(rows).toEqual([{ rollnumber: 'AB12CD34EF', email: 'a,b@x.com' }, { rollnumber: 'XY12CD34EF', email: '' }]);
  });
  it('rejects unterminated quotes and header-only files', () => {
    expect(() => parseCsv('a,b\n"x,1')).toThrow();
    expect(() => parseCsv('a,b')).toThrow();
  });
  it('neutralises formula injection on export', () => {
    expect(toCsv(['n'], [['=HYPERLINK("x")'], ['+1'], ['ok'], ['a,b']])).toBe('n\n"\'=HYPERLINK(""x"")"\n\'+1\nok\n"a,b"\n');
  });
});
