import { expect, test } from 'vitest';
import { decodePRMeta, decodeDraft, decodeMerge, decodeForge, decodeForgeReply } from './decode.ts';
test('decodes PR file maps, numeric comments, merge defaults and forge setup', () => {
  expect(decodePRMeta({ number: 7, files: { a: 'M' } }).files).toEqual({ a: 'M' });
  expect(
    decodeMerge({
      status: { state: 'clean', methods: ['squash'] },
      defaults: { squash: { title: 'title', message: 'body' } },
    }).defaults?.squash?.title,
  ).toBe('title');
  expect(
    decodeForge({ info: { label: 'Forge' }, setup: { steps: ['one'], extra: { key: 'email' } } })
      .setup?.extra?.key,
  ).toBe('email');
  expect(decodeForgeReply({ saved: true }).saved).toBe(true);
  expect(() => decodeDraft({ id: 'd1' })).toThrow();
});
