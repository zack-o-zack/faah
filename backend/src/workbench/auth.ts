import { Settings } from '../settings/service.ts';
import type { PR } from '../cli/target.ts';
export interface CloneAuth {
  env: Record<string, string | undefined>;
  redact(text: string): string;
}
function host(text: string, fallback: string): string {
  return (
    text
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '') || fallback
  ).toLowerCase();
}
function cli(args: string[]): string {
  const result = Bun.spawnSync(args, { stderr: 'ignore', timeout: 5000 });
  return result.exitCode === 0 ? result.stdout.toString().trim() : '';
}
export function cloneAuth(pr: PR): CloneAuth {
  const settings = new Settings().raw();
  const get = (key: string) => (typeof settings[key] === 'string' ? settings[key].trim() : '');
  const target = new URL(pr.url.includes('://') ? pr.url : 'https://' + pr.url).host.toLowerCase();
  let token = '',
    user = '';
  if (pr.provider === 'github') {
    token =
      get('github.token') ||
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim() ||
      cli(['gh', 'auth', 'token']);
    user = 'x-access-token';
  } else if (pr.provider === 'gitlab') {
    if (target === host(get('gitlab.host') || process.env.GITLAB_HOST || '', 'gitlab.com'))
      token = get('gitlab.token') || process.env.GITLAB_TOKEN?.trim() || '';
    token ||= cli(['glab', 'config', 'get', 'token', '--host', target]);
    user = 'oauth2';
  } else if (pr.provider === 'gitea') {
    if (target === host(get('gitea.host') || process.env.GITEA_HOST || '', 'codeberg.org'))
      token = get('gitea.token') || process.env.GITEA_TOKEN?.trim() || '';
    user = 'faah';
  } else {
    token = get('bitbucket.token') || process.env.BITBUCKET_TOKEN?.trim() || '';
    user =
      get('bitbucket.email') || process.env.BITBUCKET_EMAIL
        ? 'x-bitbucket-api-token-auth'
        : 'x-token-auth';
  }
  const auth = Buffer.from(user + ':' + token).toString('base64');
  return {
    env: token
      ? {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: `http.https://${target}/.extraheader`,
          GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + auth,
        }
      : { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    redact: (text) =>
      token ? text.split(token).join('[redacted]').split(auth).join('[redacted]') : text,
  };
}
