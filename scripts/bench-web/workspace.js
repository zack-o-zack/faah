import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const fixtures = {
  code: 'bench-large-code.js', markdown: 'bench-large-document.md', csv: 'bench-large-table.csv',
  sourceLines: 50_000, markdownLines: 5_000, csvRows: 20_000, treeFiles: 20_000,
  search: 'BENCH_SEARCH_NEEDLE_42',
  tabs: Array.from({ length: 20 }, (_, i) => `bench-tab-${String(i).padStart(2, '0')}.js`),
  deep: `deep/${Array.from({ length: 8 }, (_, i) => `level-${i + 1}`).join('/')}/branch-19/bench-deep-target.js`,
};
export async function syntheticWorkspace(root) {
  const version = 'bench-web-fixtures-v1';
  const marker = path.join(root, '.bench-web-manifest.json');
  try {
    const existing = JSON.parse(await readFile(marker, 'utf8'));
    if (existing.version === version) return describe(root, version);
    throw new Error(`Unexpected fixture manifest at ${marker}; choose a new synthetic directory`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(root, { recursive: true });
  // Never overwrite a user's workspace; this directory belongs to the generator.
  if ((await readdir(root)).length) throw new Error(`Synthetic directory is not empty: ${root}`);
  await writeFile(path.join(root, fixtures.code), Array.from({ length: fixtures.sourceLines }, (_, i) =>
    `export const benchLine${i + 1} = ${i + 1}; // BENCH_LINE_${String(i + 1).padStart(5, '0')}`).join('\n') + '\n');
  await writeFile(path.join(root, fixtures.markdown), Array.from({ length: fixtures.markdownLines }, (_, i) =>
    i === 0 ? '# Benchmark document' : i % 10 === 0 ? `## Section ${i / 10}` :
      i % 10 === 9 ? '' : `Paragraph ${i + 1}: repeatable markdown **content** and [a link](#benchmark-document).`).join('\n') + '\n');
  await writeFile(path.join(root, fixtures.csv), 'id,label,value\n' + Array.from({ length: fixtures.csvRows }, (_, i) =>
    `${i + 1},bench-row-${i + 1},${(i * 17) % 1000}`).join('\n') + '\n');
  for (const [i, name] of fixtures.tabs.entries()) await writeFile(path.join(root, name),
    `// BENCH_TAB_${i}\nexport const tabValue = ${i};\n`);
  const chain = path.dirname(path.dirname(fixtures.deep));
  for (let branch = 0; branch < 20; branch++) {
    const dir = path.join(root, chain, `branch-${String(branch).padStart(2, '0')}`);
    await mkdir(dir, { recursive: true });
    // Bounded batches avoid exhausting file descriptors.
    for (let batch = 0; batch < 10; batch++) await Promise.all(Array.from({ length: 100 }, (_, j) => {
      const i = batch * 100 + j;
      const target = branch === 19 && i === 999;
      return writeFile(path.join(dir, target ? 'bench-deep-target.js' : `file-${String(i).padStart(4, '0')}.js`),
        target ? `// ${fixtures.search}\nexport const deepTarget = true;\n` : `export const value = ${i};\n`);
    }));
  }
  const manifest = { version, ...fixtures, workloadFiles: 20_023, manifestFiles: 1 };
  await writeFile(marker, JSON.stringify(manifest, null, 2) + '\n');
  return describe(root, version);
}
async function describe(root, version) {
  const fingerprints = {};
  for (const [name, lines] of [[fixtures.code, fixtures.sourceLines], [fixtures.markdown, fixtures.markdownLines],
    [fixtures.csv, fixtures.csvRows + 1]]) {
    const content = await readFile(path.join(root, name));
    const actual = content.toString().split('\n').length - 1;
    if (actual !== lines) throw new Error(`Synthetic fixture ${name}: expected ${lines} lines, found ${actual}`);
    fingerprints[name] = { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
  }
  return { path: root, version, ...fixtures, workloadFiles: 20_023, manifestFiles: 1, fingerprints };
}
export async function realWorkspace(requested, repoRoot) {
  const root = path.resolve(requested || path.join(repoRoot, 'bench-repos/react'));
  if (!requested) {
    try { await stat(path.join(root, '.git')); }
    catch {
      await mkdir(path.dirname(root), { recursive: true });
      console.error(`Cloning default corpus into ${root}`);
      await new Promise((resolve, reject) => {
        const child = spawn('git', ['clone', '--depth', '1', '--single-branch', '--no-tags',
          'https://github.com/facebook/react.git', root], { stdio: 'inherit', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Corpus clone timed out after 180s')); }, 180_000);
        child.on('error', reject);
        child.on('exit', code => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`Corpus clone exited ${code}`));
        });
      });
    }
  }
  if (!(await stat(root)).isDirectory()) throw new Error(`Workspace is not a directory: ${root}`);
  const git = args => { try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10_000 }).trim(); } catch { return null; } };
  return { path: root, revision: git(['rev-parse', 'HEAD']), trackedFiles: git(['ls-files'])?.split('\n').length };
}
