import { expect, test } from 'vitest';
import { isProtected } from '../index.js'; 

test('isProtected handles path traversal', () => {
  expect(isProtected('C:\Windows\system32')).toBe(true);
});

test('isProtected handles simple keywords', () => {
  expect(isProtected('C:\code project\mydata')).toBe(true);
});
