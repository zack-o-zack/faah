import { expect, test } from 'vitest';
import { authorInitial, commitMessageBody } from './commit-message.ts';

test('a subject-only message has no body', () => {
  expect(commitMessageBody('Only a subject')).toBe('');
  expect(commitMessageBody('Only a subject\n')).toBe('');
});

test('hard-wrapped prose lines join back into one paragraph', () => {
  expect(
    commitMessageBody(
      'Subject\n\nThe move renamed several files, so the\nbaseline pointed at paths\nthat no longer exist.',
    ),
  ).toBe('The move renamed several files, so the baseline pointed at paths that no longer exist.');
});

test('CRLF line endings behave like LF', () => {
  expect(commitMessageBody('Subject\r\n\r\nFirst line\r\nsecond line\r\n\r\n- one\r\n- two')).toBe(
    'First line second line\n\n- one\n- two',
  );
});

test('blank lines keep paragraphs apart', () => {
  expect(commitMessageBody('Subject\n\nFirst para\nwrapped.\n\nSecond para.')).toBe(
    'First para wrapped.\n\nSecond para.',
  );
});

test('list items stay on their own lines and indentation is kept', () => {
  expect(
    commitMessageBody(
      'Subject\n\nIntro\nwrapped.\n\n- first item\n* second item\n• third item\n1. fourth item',
    ),
  ).toBe('Intro wrapped.\n\n- first item\n* second item\n• third item\n1. fourth item');
  expect(commitMessageBody('Subject\n\n    indented code\n    second line')).toBe(
    '    indented code\n    second line',
  );
});

test('surrounding blank lines are trimmed', () => {
  expect(commitMessageBody('Subject\n\nBody\n\n\n')).toBe('Body');
});

test('author initials use the first letter and fall back for an empty name', () => {
  expect(authorInitial('zack')).toBe('Z');
  expect(authorInitial('  ada lovelace')).toBe('A');
  expect(authorInitial('')).toBe('?');
  expect(authorInitial('   ')).toBe('?');
});
