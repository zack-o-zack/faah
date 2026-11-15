declare module 'basecoat-css/basecoat';
declare module 'basecoat-css/command';

interface Window {
  basecoat: {
    init: (component: string) => void;
    refresh: (element: HTMLElement) => void;
  };
}
