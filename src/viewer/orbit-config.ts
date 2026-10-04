// Bedienung der Kamera, ein Ort fuer Codeblock UND Dateiansicht (beide bauen denselben `Viewport`).
// Zwei-Finger-Scrollen auf dem Trackpad ist Zoom; deshalb gibt es Pan auf drei weiteren Wegen: Rechtsklick-
// Ziehen, Umschalt-Ziehen (OrbitControls: Umschalt/Strg/Cmd + linke Taste) und die Pfeiltasten, sobald die
// Flaeche den Fokus hat (Klick darauf). Unveraendert: Ziehen = Drehen, Rad/Pinch = Zoom.
import { MOUSE, TOUCH } from "three";

/** Der Teil von `OrbitControls`, den diese Konfiguration setzt (damit ein Test ohne WebGL auskommt). */
export interface OrbitLike {
  enablePan: boolean;
  screenSpacePanning: boolean;
  keyPanSpeed: number;
  mouseButtons: { LEFT?: MOUSE | null; MIDDLE?: MOUSE | null; RIGHT?: MOUSE | null };
  touches: { ONE?: TOUCH | null; TWO?: TOUCH | null };
}

export function configurePan(controls: OrbitLike): void {
  controls.enablePan = true;
  // Pan in der Bildebene (hoch/runter heisst hoch/runter), nicht entlang der Bodenebene.
  controls.screenSpacePanning = true;
  controls.keyPanSpeed = 14;
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
}
