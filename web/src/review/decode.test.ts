import { expect, test } from 'vitest';
import { decodeReviewEvent, decodeReviewStatus, decodeWalkthrough } from './decode.ts';
test('decodes full runs, stage events and walkthrough file groups', () => {
  expect(
    decodeReviewStatus({
      run: {
        id: 'r',
        status: 'running',
        stages: [{ def: { id: 'a', title: 'A' }, status: 'running' }],
      },
    }).run?.stages[0]?.def.id,
  ).toBe('a');
  expect(
    decodeReviewEvent({
      runId: 'r',
      stageIndex: 0,
      stage: { def: { id: 'a' }, status: 'completed' },
    }),
  ).toMatchObject({ stageIndex: 0 });
  expect(
    decodeWalkthrough({
      files: [
        {
          path: 'a',
          group: 'core',
          oldPath: 'old',
        },
      ],
    }).files[0]?.oldPath,
  ).toBe('old');
  expect(() => decodeReviewStatus({ run: { activeStage: '1' } })).toThrow();
});
