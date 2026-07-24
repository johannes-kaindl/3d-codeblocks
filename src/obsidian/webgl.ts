// WebGL-Verfuegbarkeit. Bewusst hier und nicht in `viewer/`: das ist eine Frage an die
// Umgebung, keine ans Rendering — und `createEl` ist Obsidians DOM-Helfer.

export function isWebGLAvailable(): boolean {
  try {
    const canvas = createEl("canvas");
    const available = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    canvas.remove();
    return available;
  } catch {
    return false;
  }
}
