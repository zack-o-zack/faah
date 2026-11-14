import { mutation, capture } from './harness.ts';
const cases: [string, string][] = [
  ['decimal', '{"active":1.0}'],
  ['exponent', '{"active":1e0}'],
  ['overflow', '{"active":9223372036854775808}'],
  ['maximum', '{"active":9223372036854775807}'],
  ['minimum', '{"active":-9223372036854775808}'],
  ['uppercase', '{"ACTIVE":"wrong"}'],
];
for (const [name, text] of cases) {
  mutation('session-numbers', name, async (context) => {
    await capture(context, 'session-numbers', name, 'api/session', { method: 'POST', text });
    await capture(context, 'session-numbers', name + '-reread', 'api/session');
  });
}
