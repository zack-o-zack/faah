import { record, text, boolean } from '../lib/decode.ts';
export interface HoldingPage {
  Base: string;
  Theme: string;
  Retry: string;
  Choose: string;
  Title: string;
  Sub: string;
  Error: string;
  Progress: string;
  Self: string;
  PR: boolean;
  Starting: boolean;
}
export function decodeHoldingPage(value: unknown): HoldingPage {
  const page = record(value);
  return {
    Base: text(page.Base),
    Theme: text(page.Theme),
    Retry: text(page.Retry),
    Choose: text(page.Choose),
    Title: text(page.Title),
    Sub: text(page.Sub),
    Error: text(page.Error),
    Progress: text(page.Progress),
    Self: text(page.Self),
    PR: boolean(page.PR),
    Starting: boolean(page.Starting),
  };
}
