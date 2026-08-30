// Eine in der Datei definierte Kamera → `CameraFit`. Kennt Obsidian nicht.
//
// Der Gegenpol zu `viewToCamera` in `core/view-spec.ts`: dort wird eine Ansicht aus
// Winkeln um das Modellzentrum GERECHNET, hier wird eine vom Autor gesetzte Kamera
// UEBERNOMMEN. Beide muenden in denselben `CameraFit`, deshalb kennt der Viewport nur
// einen Weg, die Kamera zu setzen.
//
// Warum das Ziel nicht das Modellzentrum ist: eine Autorenkamera rahmt oft einen
// Ausschnitt (einen Eingang, einen Schnitt) statt das ganze Modell. Zoege man das
// Orbit-Ziel ins Zentrum, kippte die Blickrichtung — und das Bild waere nicht mehr das,
// das der Autor gesetzt hat. Das Ziel liegt deshalb auf der Blickachse; nur wie WEIT
// entfernt, bestimmt das Modell.
import { Quaternion, Vector3 } from "three";
import { MIN_EXTENT, type CameraFit, type Vec3 } from "../core/camera-fit";
import type { FileCamera } from "./loaders";

const FORWARD = new Vector3(0, 0, -1);

/** Kamera-Knoten → Kameraposition, Orbit-Ziel und Clipping-Ebenen. */
export function fileCameraFit(camera: FileCamera, min: Vec3, max: Vec3): CameraFit {
  // Der Knoten haengt in der geladenen Szene; seine Weltmatrix ist erst nach diesem
  // Aufruf verlaesslich, wenn ein Elternknoten dazwischenliegt.
  camera.object.updateWorldMatrix(true, false);

  const position = new Vector3().setFromMatrixPosition(camera.object.matrixWorld);
  const rotation = new Quaternion().setFromRotationMatrix(camera.object.matrixWorld);
  const forward = FORWARD.clone().applyQuaternion(rotation).normalize();

  const center = new Vector3(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    (min.z + max.z) / 2,
  );
  const radius =
    Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2 || MIN_EXTENT;

  // Abstand = Projektion des Modellzentrums auf die Blickachse. Blickt die Kamera vom
  // Modell WEG, ist die Projektion negativ; dann liegt das Ziel eine Modellbreite vor
  // der Kamera, statt in ihrem Ruecken — sonst kreiste der erste Zug der Maus um einen
  // Punkt, den der Nutzer gar nicht sieht.
  const projected = center.clone().sub(position).dot(forward);
  const distance = projected > MIN_EXTENT ? projected : Math.max(radius * 2, MIN_EXTENT);

  const target = position.clone().addScaledVector(forward, distance);

  return {
    position: { x: position.x, y: position.y, z: position.z },
    target: { x: target.x, y: target.y, z: target.z },
    near: Math.max(distance / 1000, MIN_EXTENT),
    far: distance + radius * 10,
    distance,
    radius,
  };
}
