export interface Node {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  ignored?: boolean;
  status?: string;
  staged?: boolean;
  partial?: boolean;
  dirty?: boolean;
  yourStatus?: string;
  yourDirty?: boolean;
}
export interface GitState {
  git: boolean;
  statuses: Record<string, string>;
  staged: Record<string, boolean>;
  partial: Record<string, boolean>;
  yourStatuses: Record<string, string>;
}
export const emptyGit = (): GitState => ({
  git: false,
  statuses: {},
  staged: {},
  partial: {},
  yourStatuses: {},
});
