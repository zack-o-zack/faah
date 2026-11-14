import { expect, test } from 'bun:test';
import { childEnvironment } from '../src/cli/environment.ts';
import { Child } from '../src/legacy/child.ts';

test('headless children connect to the existing user bus without auto-launching one', () => {
  const input = { PATH: '/usr/bin', XDG_RUNTIME_DIR: '/tmp/runtime-user' };
  expect(childEnvironment(input, 'linux', 1000).DBUS_SESSION_BUS_ADDRESS).toBe(
    'unix:path=/tmp/runtime-user/bus',
  );
  expect(childEnvironment({}, 'linux', 1000).DBUS_SESSION_BUS_ADDRESS).toBe(
    'unix:path=/run/user/1000/bus',
  );
  expect(input).not.toHaveProperty('DBUS_SESSION_BUS_ADDRESS');
  for (const input of [
    { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/custom/bus' },
    { DISPLAY: ':0' },
    { WAYLAND_DISPLAY: 'wayland-0' },
  ])
    expect(childEnvironment(input, 'linux', 1000)).toEqual(input);
  expect(childEnvironment({}, 'darwin', 1000)).toEqual({});
});

test('legacy child receives the safe keyring environment and exits on shutdown', async () => {
  const child = new Child(
    [
      process.execPath,
      '-e',
      'console.log("faah-ready " + (process.env.DBUS_SESSION_BUS_ADDRESS || "absent")); process.stdin.resume(); process.stdin.on("end", () => process.exit(0))',
    ],
    process.cwd(),
  );
  try {
    expect(await child.ready).toBe(
      'http://' + (childEnvironment().DBUS_SESSION_BUS_ADDRESS || 'absent'),
    );
  } finally {
    await child.stop();
  }
  expect(child.process.exitCode).toBe(0);
});
