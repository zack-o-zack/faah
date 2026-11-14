import { mutation, capture } from './harness.ts';

const cases: [string, string][] = [
  ['null', 'null'],
  [
    'case-and-trailing',
    '{"Tabs":[null,{"PATH":"hello","ref":"","unknown":true}],"ACTIVE":2,"OPENDIRS":[null,"src"]} ignored',
  ],
  ['duplicates', '{"tabs":[{"path":"old"}],"Tabs":[],"active":3,"Active":null,"openDirs":[]}'],
  ['ignored-drafts', '{"drafts":[{"body":"not writable through UI state"}],"unknown":true}'],
  ['invalid-tabs', '{"tabs":1}'],
  ['invalid-tab', '{"tabs":[1]}'],
  ['invalid-path', '{"tabs":[{"path":1}]}'],
  ['invalid-active', '{"active":"1"}'],
  ['invalid-dirs', '{"openDirs":[1]}'],
  ['invalid-object', '[]'],
  ['empty', ''],
];
for (const [name, text] of cases) {
  mutation('session-native', name, async (context) => {
    await capture(context, 'session-native', name, 'api/session', { method: 'POST', text });
    await capture(context, 'session-native', name + '-reread', 'api/session');
  });
}
