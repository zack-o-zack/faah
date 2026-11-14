declare module '*.bundle' {
  const path: string;
  export default path;
}
declare module '*/bin/rg' {
  const path: string;
  export default path;
}
declare module '*.node' {
  const binding: {
    subscribe(
      path: string,
      callback: (error: Error | null, events: { path: string }[]) => void,
      options: Record<string, unknown>,
    ): Promise<void>;
    unsubscribe(
      path: string,
      callback: (error: Error | null, events: { path: string }[]) => void,
      options: Record<string, unknown>,
    ): Promise<void>;
  };
  export default binding;
}
