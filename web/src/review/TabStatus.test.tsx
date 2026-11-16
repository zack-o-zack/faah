import { render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { TabStatus, tabStatus, type TabStatusState } from './TabStatus.tsx';

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
  expect(tabStatus(source)).toBe(expected),
);

for (const noun of ['checks', 'stages'] as const) {
  test.each([
    {
      statuses: ['failed', 'running'],
      text: '1',
      icon: 'x-circle',
      breakdown: '1 failed, 1 running',
    },
    {
      statuses: ['passed', 'running', 'queued'],
      text: '1/3',
      icon: 'circle-notch',
      breakdown: '1 running, 1 queued, 1 passed',
    },
    {
      statuses: ['passed', 'skipped', 'neutral'],
      text: '3',
      icon: '',
      breakdown: '1 passed, 1 skipped, 1 neutral',
    },
    { statuses: ['pending', 'pending'], text: '2', icon: '', breakdown: '2 pending' },
  ] as { statuses: TabStatusState[]; text: string; icon: string; breakdown: string }[])(
    '$breakdown ' + noun + ' is compact',
    ({ statuses, text, icon, breakdown }) => {
      render(() => <TabStatus noun={noun} statuses={statuses} />);
      const title = `${noun === 'checks' ? 'Checks' : 'Stages'}: ${breakdown}`;
      const count = screen.getByLabelText(title);
      expect(count.textContent).toBe(text);
      expect(count.getAttribute('title')).toBe(title);
      expect(count.classList.contains('badge')).toBe(false);
      expect(count.hasAttribute('data-variant')).toBe(false);
      expect(count.classList.contains('tabular-nums')).toBe(true);
      if (icon) {
        expect(count.children).toHaveLength(1);
        expect(count.firstElementChild?.className).toContain(`icon-[ph--${icon}]`);
        if (icon === 'circle-notch')
          expect(count.firstElementChild?.className).toContain('motion-safe:animate-spin');
      } else expect(count.children).toHaveLength(0);
    },
  );
}

test('finished mixtures and large lists show only the total', () => {
  const { unmount } = render(() => (
    <TabStatus
      noun="checks"
      statuses={['passed', 'passed', 'passed', 'passed', 'passed', 'skipped']}
    />
  ));
  const count = screen.getByLabelText('Checks: 5 passed, 1 skipped');
  expect(count.textContent).toBe('6');
  expect(count.children).toHaveLength(0);
  unmount();
  render(() => (
    <TabStatus noun="checks" statuses={Array.from({ length: 500 }, () => tabStatus('passed'))} />
  ));
  expect(screen.getByLabelText('Checks: 500 passed').textContent).toBe('500');
});

test.each([0, 1, 34])('Changed files uses the same plain count component for %i files', (count) => {
  render(() => <TabStatus noun="files" count={count} />);
  const value = screen.getByLabelText(`Changed files: ${count}`);
  expect(value.textContent).toBe(String(count));
  expect(value.children).toHaveLength(0);
  expect(value.classList.contains('badge')).toBe(false);
});

test.each(['checks', 'stages'] as const)('%s renders nothing when loading or empty', (noun) => {
  const { container, unmount } = render(() => (
    <TabStatus noun={noun} statuses={['passed']} loading />
  ));
  expect(container.childElementCount).toBe(0);
  unmount();
  const view = render(() => <TabStatus noun={noun} statuses={[]} />);
  expect(view.container.childElementCount).toBe(0);
});

test('a load error is only an accessible destructive icon', () => {
  render(() => <TabStatus noun="checks" statuses={[]} error />);
  const value = screen.getByLabelText("Checks: couldn't load");
  expect(value.textContent).toBe('');
  expect(value.children).toHaveLength(1);
  expect(value.firstElementChild?.className).toContain('icon-[ph--x-circle] text-destructive');
});

test('Changed files hides its count while loading', () => {
  const { container } = render(() => <TabStatus noun="files" count={34} loading />);
  expect(container.childElementCount).toBe(0);
});
