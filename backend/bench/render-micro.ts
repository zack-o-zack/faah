import { readFile } from 'node:fs/promises';
import { Document } from '../src/render/document.ts';
import { RenderPool } from '../src/render/pool.ts';
import { renderMarkdown } from '../src/markdown/service.ts';
import { renderTable, sniffDelimiter } from '../src/table/service.ts';
import { record, string, number } from '../src/decode.ts';
const baseline = record(
  JSON.parse(
    await readFile(new URL('../../bench/results/go-micro-c32fe4e.json', import.meta.url), 'utf8'),
  ),
);
if (!Array.isArray(baseline.benchmarks)) throw new Error('invalid baseline');
const go = new Map(
  baseline.benchmarks.map((v) => {
    const r = record(v);
    return [string(r.name).split('/').at(-1) ?? '', number(r.nsPerOp)];
  }),
);
const results: { name: string; nsPerOp: number; goNsPerOp: number; samples: number[] }[] = [];
function report(name: string, samples: number[]): void {
  const goNsPerOp = go.get(name);
  if (goNsPerOp === undefined) throw new Error('missing baseline ' + name);
  const result = { name, nsPerOp: [...samples].sort((a, b) => a - b)[1] ?? 0, goNsPerOp, samples };
  results.push(result);
  process.stdout.write(JSON.stringify(result) + '\n');
}
function measure(name: string, run: () => unknown): void {
  for (let i = 0; i < 100; i++) run();
  const start = performance.now();
  for (let i = 0; i < 1000; i++) run();
  const count = Math.min(
    1000000,
    Math.max(10, Math.ceil(300000 / Math.max(performance.now() - start, 0.001))),
  );
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    for (let j = 0; j < count; j++) run();
    samples.push(((performance.now() - start) * 1e6) / count);
  }
  report(name, samples);
}
async function measureAsync(name: string, run: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < 10; i++) await run();
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    let count = 0;
    do {
      await run();
      count++;
    } while (performance.now() - start < 300);
    samples.push(((performance.now() - start) * 1e6) / count);
  }
  report(name, samples);
}
const pool = new RenderPool(),
  highlight = (s: string, l: string, n: number) => pool.render(s, l, n);
const goSource = `package main

import (
\t"fmt"
\t"sync"
\t"time"
)

type WorkerPool struct {
\ttasks chan func()
\twg    sync.WaitGroup
}

func NewWorkerPool(workers int) *WorkerPool {
\tp := &WorkerPool{tasks: make(chan func(), 128)}
\tfor i := 0; i < workers; i++ {
\t\tp.wg.Add(1)
\t\tgo func() {
\t\t\tdefer p.wg.Done()
\t\t\tfor t := range p.tasks {
\t\t\t\tt()
\t\t\t}
\t\t}()
\t}
\treturn p
}
`;
const python = `import os
import sys
from dataclasses import dataclass

@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 8080
    debug: bool = False

def run_server(cfg: Config):
    print(f"Starting server on {cfg.host}:{cfg.port}")
    if cfg.debug:
        print("Debug mode enabled")
`;
try {
  for (const [name, source, path] of [
    ['BenchmarkHighlightLines_Go', goSource, 'main.go'],
    ['BenchmarkHighlightLines_Python', python, 'app.py'],
  ] as const) {
    const doc = new Document(source, path, highlight);
    await doc.lines(0, doc.total);
    await measureAsync(name, () => doc.lines(0, doc.total));
  }
  const simple =
    'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n';
  measure('BenchmarkNewDoc', () => new Document(simple, 'main.go', highlight));
  const repeated = 'func exampleLine() { return 42 }\n'.repeat(200);
  measure('BenchmarkDocCreation', () => new Document(repeated, 'example.go', highlight));
  const cold = 'func exampleLine(x int) int { return x * 2 }\n'.repeat(200);
  await measureAsync('BenchmarkColdHighlight_Go', () =>
    new Document(cold, 'example.go', highlight).lines(0, 300),
  );
  const markdown =
    '# Header\n\nParagraph with **bold** text and list:\n- item 1\n- item 2\n\n```go\npackage main\nfunc main() {}\n```\n';
  await measureAsync('BenchmarkRenderMarkdown', () => renderMarkdown(markdown, highlight));
  const csv = Buffer.from(
    'id,name,role,department,location,salary\n1,Alice,Engineer,Core,New York,150000\n2,Bob,Designer,UI,San Francisco,140000\n3,Charlie,Product,Core,Remote,160000\n4,Dana,DevOps,Infra,London,155000\n',
  );
  measure('BenchmarkRenderTable', () => renderTable(csv, csv.length, ','));
  const head = 'id,name,role,department,location,salary\n1,Alice,Engineer,Core,New York,150000\n';
  measure('BenchmarkSniffDelim', () => sniffDelimiter(head, ','));
  await Bun.write(
    process.env.FAAH_MICRO_REPORT ?? '/tmp/faah-phase3-render-micro.json',
    JSON.stringify({ runtime: Bun.version, benchmarks: results }, null, 2) + '\n',
  );
} finally {
  pool.close();
}
