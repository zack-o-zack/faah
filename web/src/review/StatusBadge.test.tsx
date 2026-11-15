import { render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { StatusBadge, badgeStatus, type BadgeStatus } from './StatusBadge.tsx';

test.each([
  ['failed', 'failed'],
  ['running', 'running'],
  ['queued', 'queued'],
  ['pending', 'pending'],
  ['completed', 'passed'],
  ['passed', 'passed'],
  ['stopped', 'skipped'],
  ['skipped', 'skipped'],
  ['neutral', 'neutral'],
] as const)('maps check/stage status %s to %s', (source, expected) =>
  expect(badgeStatus(source)).toBe(expected),
);

for (const noun of ['checks', 'stages'] as const) {
  test.each([
    { statuses: ['failed', 'running'], text: '1 failed', icon: 'circle-x' },
    { statuses: ['passed', 'running', 'queued'], text: '1/3', icon: 'loader-circle' },
    { statuses: ['passed', 'skipped', 'neutral'], text: '3', icon: 'circle-check' },
    { statuses: ['pending', 'pending'], text: '2', icon: 'circle-dashed' },
  ] as { statuses: BadgeStatus[]; text: string; icon: string }[])(
    '%s ' + noun + ' uses one icon and count',
    ({ statuses, text, icon }) => {
      render(() => <StatusBadge noun={noun} statuses={statuses} />);
      const pill = screen.getByLabelText(
        new RegExp('^' + (noun === 'checks' ? 'Checks' : 'Stages') + ':'),
      );
      expect(pill.textContent).toBe(text);
      expect(pill.children).toHaveLength(1);
      expect(pill.firstElementChild?.className).toContain(`icon-[lucide--${icon}]`);
      expect(pill.querySelector('.rounded-full')).toBeNull();
      expect(pill.getAttribute('data-variant')).toBe('outline');
    },
  );
}

test('five passed plus one skipped is green, and 500 items still use a single icon', () => {
  const { unmount } = render(() => (
    <StatusBadge
      noun="checks"
      statuses={['passed', 'passed', 'passed', 'passed', 'passed', 'skipped']}
    />
  ));
  const pill = screen.getByLabelText('Checks: 5 passed, 1 skipped');
  expect(pill.textContent).toBe('6');
  expect(pill.firstElementChild?.className).toContain('text-gi');
  unmount();
  render(() => (
    <StatusBadge
      noun="checks"
      statuses={Array.from({ length: 500 }, () => badgeStatus('passed'))}
    />
  ));
  expect(screen.getByLabelText('Checks: 500 passed').children).toHaveLength(1);
});

test.each([0, 1, 2])(
  'failed count and aria text handle %i failures without pluralizing adjectives',
  (count) => {
    render(() => (
      <StatusBadge
        noun="checks"
        statuses={['passed', ...Array.from({ length: count }, () => badgeStatus('failed'))]}
      />
    ));
    const title = count ? `Checks: ${count} failed, 1 passed` : 'Checks: 1 passed';
    expect(screen.getByLabelText(title).textContent).toBe(count ? `${count} failed` : '1');
  },
);
