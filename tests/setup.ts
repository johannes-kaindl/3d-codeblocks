// Globaler Test-Setup: Node kennt (Stand Node 24) kein `ProgressEvent`, three's
// FileLoader nutzt es aber beim Fetch von data-URI-Buffern (GLTFLoader.parse fuer
// JSON-glTF ohne Texturen). Minimaler, spec-treuer Polyfill, damit der Loader
// headless laeuft -- keine Aenderung am Verhalten in echten Browsern.
if (typeof globalThis.ProgressEvent === "undefined") {
  class ProgressEventPolyfill extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;

    constructor(type: string, init: ProgressEventInit = {}) {
      super(type, init);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ProgressEvent = ProgressEventPolyfill;
}
