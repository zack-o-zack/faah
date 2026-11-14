import { newItem, type Item } from '../src/fuzzy/score.ts';
export const fuzzyPaths = [
  'internal/server/http_server.go',
  'cmd/px0/main.go',
  'web/app.js',
  'pkg/util/strings.go',
  'vendor/github.com/x/http/server.go',
  'httpserver.go',
  'src/core/router.go',
  'api/v1/endpoints.go',
];
export function generateItems(n: number): Item[] {
  const dirs = [
    'src',
    'pkg',
    'internal',
    'cmd',
    'pkg/util',
    'web/src/components',
    'api/v1',
    'services',
  ];
  const names = [
    'server.go',
    'client.go',
    'handler.go',
    'types.go',
    'utils.go',
    'index.ts',
    'app.py',
    'main.rs',
  ];
  return Array.from({ length: n }, (_, i) =>
    newItem(`${dirs[i % dirs.length]}/${i}_${names[i % names.length]}`),
  );
}
export const goOutline =
  'package main\ntype Client struct{}\nconst Version = "1.0"\nvar DefaultClient *Client\nfunc NewClient() *Client { return nil }\nfunc (c *Client) Send() error { return nil }\n';
export const markdownOutline =
  '# Title\n## Section 1\nText text\n### Subsection 1.1\n## Section 2\n';
