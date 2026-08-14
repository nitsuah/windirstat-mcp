import { expect, test } from 'vitest';
import { isProtected } from '../index.js';

test('isProtected handles path traversal', () => {
  // Should ideally be protected if it resolves to a protected path
  expect(isProtected('C:\\Windows\\system32')).toBe(true);
});

test('isProtected handles simple keywords', () => {
  expect(isProtected('C:\\code project\\mydata')).toBe(true);
});
