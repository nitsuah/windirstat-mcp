import fs from 'fs';
import { expect, test, vi } from 'vitest';
import { isProtected } from '../index.js';

test('isProtected handles path traversal', () => {
  const spy = vi.spyOn(fs, 'realpathSync').mockReturnValue('C:\\Windows\\System32');
  expect(isProtected('C:\\Users\\alice\\..\\Windows\\System32')).toBe(true);
  expect(spy).toHaveBeenCalledOnce();
  spy.mockRestore();
});

test('isProtected handles simple keywords', () => {
  expect(isProtected('C:\\code project\\mydata')).toBe(true);
});

test('isProtected fails closed for permission errors', () => {
  const spy = vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
    const err = new Error('permission denied');
    err.code = 'EACCES';
    throw err;
  });
  expect(isProtected('C:\\not-obviously-protected')).toBe(true);
  spy.mockRestore();
});
