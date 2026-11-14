/**
 * Child processes may consult desktop keyrings (including `gh auth token`).
 * On headless Linux, libdbus otherwise auto-launches a new session daemon for
 * every lookup. Connect to the user's existing bus instead; an absent socket
 * fails without spawning an orphan. Explicit buses and graphical sessions keep
 * their original discovery rules.
 */
export function childEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userID: number = process.getuid?.() ?? 0,
): NodeJS.ProcessEnv {
  if (
    platform !== 'linux' ||
    environment.DBUS_SESSION_BUS_ADDRESS ||
    environment.DISPLAY ||
    environment.WAYLAND_DISPLAY
  )
    return { ...environment };
  const runtime = environment.XDG_RUNTIME_DIR || '/run/user/' + userID;
  return {
    ...environment,
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + runtime + '/bus',
  };
}
