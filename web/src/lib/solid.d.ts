import 'solid-js';

declare module 'solid-js' {
  namespace JSX {
    interface ExplicitProperties {
      indeterminate: boolean;
    }
  }
}
