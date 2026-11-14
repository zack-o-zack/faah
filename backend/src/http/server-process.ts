import type { RouteTable } from './routes.ts';

/** What `main` needs from a composed process: its routes and its shutdown. */
export interface ServerProcess {
  readonly routes: RouteTable;
  /** Workspaces gzip responses; the workbench does not. */
  readonly gzip: boolean;
  onRequest?(route: string, request: Request): void;
  close(): Promise<void>;
}
