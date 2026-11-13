import type { WorkbenchMetrics } from './decode.ts';

interface MetricsMenuProps {
  metrics?: WorkbenchMetrics | null;
}
import type { JSX } from 'solid-js';
import { MetricsPopover } from '../status/Metrics.tsx';
export function MetricsMenu(props: MetricsMenuProps): JSX.Element {
  return <MetricsPopover metrics={props.metrics} />;
}
