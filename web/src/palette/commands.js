import { createSignal } from 'solid-js';
export function createCommandRegistry() {
  const entries = new Map();
  const [revision, publish] = createSignal(0);
  return {
    list() {
      revision();
      return [...entries.values()];
    },
    register(commands) {
      for (const command of commands) entries.set(command.id || command.name, command);
      publish((value) => value + 1);
      return () => {
        for (const command of commands) {
          const key = command.id || command.name;
          if (entries.get(key) === command) entries.delete(key);
        }
        publish((value) => value + 1);
      };
    },
  };
}
