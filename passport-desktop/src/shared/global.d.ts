// ---------------------------------------------------------------------------
// Global augmentations for Window properties used by Tauri and third-party libs
// ---------------------------------------------------------------------------

interface Window {
  __TAURI__?: {
    core?: {
      invoke: (...args: any[]) => Promise<any>;
      convertFileSrc?: (path: string) => string;
    };
    event?: {
      listen: (event: string, handler: (event: any) => void) => Promise<() => void>;
    };
    dialog?: {
      open: (options?: any) => Promise<string | string[] | null>;
    };
  };
  __PASSPORT_BROWSER_BRIDGE__?: any;
  flatpickr?: any;
}
