#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, freshPage, load } from './browser.js';
import { startServer, serverFlags } from './server.js';
import { realWorkspace, syntheticWorkspace } from './workspace.js';
import { aggregate, formatTable, profileSelfTime } from './metrics.js';
import { cold } from './scenarios/cold.js';
import { finder } from './scenarios/finder.js';
import { scroll } from './scenarios/scroll.js';
import { editor } from './scenarios/editor.js';
import { tabs, memory } from './scenarios/tabs.js';
import { treeSearch } from './scenarios/tree-search.js';
import { previews } from './scenarios/previews.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: {
  binary: { type: 'string', default: './faah' }, workspace: { type: 'string' },
  runs: { type: 'string', default: '5' }, json: { type: 'string', default: 'bench-out/frontend.json' },
  synthetic: { type: 'string', default: path.join(root, 'bench-repos/web-synthetic-v1') },
  out: { type: 'string', default: path.join(root, 'bench-out') },
  help: { type: 'boolean', short: 'h', default: false },
} });
if (values.help) {
  console.log(`Usage: npm run bench:web -- [--binary ./faah] [--workspace PATH] [--runs 5] [--json out.json]
  --workspace PATH  Real repository for cold-load tests (default: clone/reuse bench-repos/react).
  --synthetic PATH  Generated stress corpus (default: bench-repos/web-synthetic-v1).
  --out PATH        CPU profiles and diagnostics (default: bench-out).
No builds are performed. Requires Chrome, or npx playwright-core install chromium.
Failures are written to JSON; any failed scenario causes exit status 1.`);
} else {
  const runs = Number(values.runs);
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  await main(runs);
}

async function main(count) {
  const binary = path.resolve(values.binary);
  const output = path.resolve(values.out);
  await mkdir(output, { recursive: true });
  const real = await realWorkspace(values.workspace, root);
  const synthetic = await syntheticWorkspace(path.resolve(values.synthetic));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10_000 }).trim();
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), sourceRevision: git(['rev-parse', 'HEAD']),
    binary: { path: binary, sha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
      version: execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim() },
    machine: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
    config: { runs: count, viewport: { width: 1440, height: 900 }, headless: true, serverFlags,
      profilePasses: 'Separate untimed diagnostic passes for finder and scroll',
      aggregation: 'Pooled action samples across all runs; nearest-rank p95, interpolated median',
      cold: 'Fresh browser context, empty HTTP cache, indexed long-running server; not cold OS/backend cache',
      frameBudgetMs: 16.7, scrollSteps: 240, scrollLines: 20_000, eventTimingThresholdMs: 16 },
    workspaces: { real, synthetic }, runs: [], profiles: [], failures: [],
  };
  let browser;
  const servers = [];
  let cleanup;
  const stop = () => cleanup ??= (async () => {
    await browser?.close().catch(() => {});
    await Promise.allSettled(servers.map(server => server.stop()));
  })();
  const onInterrupt = async () => { await stop(); process.exit(130); };
  const onTerminate = async () => { await stop(); process.exit(143); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    report.browser = { channel: launched.channel, version: browser.version(), playwrightCore: JSON.parse(
      await readFile(path.join(root, 'node_modules/playwright-core/package.json'), 'utf8')).version };
    console.error(`Browser: ${report.browser.channel} ${report.browser.version}; ${count} runs; ${report.machine.cpu}`);
    const realServer = await startServer(binary, real.path);
    servers.push(realServer);
    const syntheticServer = await startServer(binary, synthetic.path);
    servers.push(syntheticServer);
    const indexInfo = ({ files, indexMs, name, version }) => ({ files, indexMs, name, version });
    report.workspaces.real.index = indexInfo(realServer.meta);
    report.workspaces.synthetic.index = indexInfo(syntheticServer.meta);
    const scenarios = [
      ['cold.real', cold, realServer.url], ['cold.synthetic', cold, syntheticServer.url],
      ['finder', finder], ['scroll', scroll], ['editor', editor], ['tabs', tabs],
      ['tree-search', treeSearch], ['previews', previews], ['memory', memory],
    ];
    for (let run = 1; run <= count; run++) for (const [name, scenario, url = syntheticServer.url] of scenarios) {
      await execute(name, scenario, url, run);
    }
    for (const [name, scenario] of [['finder', finder], ['scroll', scroll]]) {
      await execute(`profile.${name}`, scenario, syntheticServer.url, 0, true);
    }
  } catch (error) {
    report.failures.push(`[setup/runner] ${error.message}`);
    console.error(error);
  } finally {
    await stop();
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    report.summary = aggregate(report.runs.filter(run => run.status === 'passed'));
    report.completedAt = new Date().toISOString();
    await mkdir(path.dirname(path.resolve(values.json)), { recursive: true });
    // Raw event/frame samples are compact; stdout and the docs provide the readable table.
    await writeFile(values.json, JSON.stringify(report) + '\n');
    console.log(formatTable(report.summary));
    for (const profile of report.profiles) {
      console.log(`\nTop 15 self-time functions: ${profile.scenario} (${profile.path})`);
      console.table(profile.top.map(({ name, selfMs, percent, url, line, column }) => ({
        function: name, selfMs: selfMs.toFixed(2), percent: percent.toFixed(2),
        source: url ? `${url.replace(/http:\/\/127\.0\.0\.1:\d+/, '<origin>')}:${line}:${column}` : '',
      })));
    }
    console.error(`JSON: ${path.resolve(values.json)}; failures: ${report.failures.length}`);
    if (report.failures.length) process.exitCode = 1;
  }

  async function execute(name, scenario, url, run, profiling = false) {
    console.error(`[${profiling ? 'diagnostic' : `${run}/${count}`}] ${name}`);
    const { page, context } = await freshPage(browser);
    const result = { run, scenario: name, status: 'passed', metrics: {}, details: {} };
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    let cdp;
    let scenarioTimer;
    try {
      if (scenario !== cold) await load(page, url);
      if (profiling) {
        cdp = await context.newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
        await cdp.send('Profiler.start');
      }
      await Promise.race([
        scenario({ page, result, url, prefix: name }),
        new Promise((_, reject) => {
          scenarioTimer = setTimeout(() => reject(new Error('Scenario exceeded 180s deadline')), 180_000);
        }),
      ]);
    } catch (error) {
      result.status = 'failed';
      result.error = `[${name}, run ${run}] ${error.message}`;
      report.failures.push(result.error);
      console.error(result.error);
      const stem = `${name.replaceAll('.', '-')}-${run}`;
      await page.screenshot({ path: path.join(output, `${stem}.png`), timeout: 5000 }).catch(() => {});
      await writeFile(path.join(output, `${stem}.html`), await page.content().catch(() => 'Page unavailable'));
    } finally {
      clearTimeout(scenarioTimer);
      if (cdp) {
        try {
          const { profile } = await cdp.send('Profiler.stop');
          const filename = path.join(output, `${name}.cpuprofile`);
          await writeFile(filename, JSON.stringify(profile));
          report.profiles.push({ scenario: name, path: path.relative(root, filename),
            status: result.status, top: profileSelfTime(profile) });
        } catch (error) { report.failures.push(`[${name}] CPU profile failed: ${error.message}`); }
        await cdp.detach().catch(() => {});
      }
      result.pageErrors = pageErrors;
      if (pageErrors.length) {
        report.failures.push(`[${name}, run ${run}] Page errors: ${pageErrors.join('; ')}`);
        result.status = 'failed';
      }
      if (!profiling) report.runs.push(result);
      await context.close();
    }
  }
}
