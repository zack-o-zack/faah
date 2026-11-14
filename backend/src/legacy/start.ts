import { featureArgs, type Flags } from '../cli/flags.ts';
import { detectPR, resolveTarget } from '../cli/target.ts';
import { Child } from './child.ts';
export async function startLegacy(flags: Flags, base: string): Promise<Child> {
  const target = flags.targets[0] ?? '.';
  if (target === 'pr')
    throw new Error(
      "'faah pr' is no longer supported; open pull requests directly with: faah <url>",
    );
  if (detectPR(target) && flags.bool.has('no-git'))
    throw new Error('faah: git is required for PR review; remove -no-git');
  if (!detectPR(target)) resolveTarget(target);
  const binary = process.env.FAAH_LEGACY_BIN;
  if (!binary) throw new Error('FAAH_LEGACY_BIN is required until phase 8');
  const child = new Child(
    [
      binary,
      '-workbench-child',
      '-host',
      '127.0.0.1',
      '-port',
      '0',
      '-no-open',
      '-no-update',
      '-no-color',
      ...featureArgs(flags),
      '-base-path',
      base,
      target,
    ],
    process.cwd(),
  );
  await child.ready;
  return child;
}
