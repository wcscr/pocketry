import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide, type BufferGeometry } from "three";
import { surfaceTextName, type SurfaceText } from "@shared/gridfinity/surface-text";

/** The whole label bounds select it, including counters and spaces between letters. */
export function SurfaceTextMesh({ label, geometry, color, selected, onSelect }: {
  label: SurfaceText; geometry: BufferGeometry; color: string; selected: boolean;
  onSelect?: (id: string) => void;
}): JSX.Element {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const select = (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect || event.button !== 0 || event.delta > 4) return;
    event.stopPropagation();
    onSelect(label.id);
  };
  return <group name={`Text: ${surfaceTextName(label)}`} onClick={select}>
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.02}
        emissive={selected ? "#0891b2" : "#000000"} emissiveIntensity={selected ? 0.35 : 0} />
    </mesh>
    {onSelect && bounds && !bounds.isEmpty() && <mesh name="surface-text-hit-area"
      position={[(bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, bounds.max.z + 0.01]}>
      <planeGeometry args={[bounds.max.x - bounds.min.x + 1, bounds.max.y - bounds.min.y + 1]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={DoubleSide} />
    </mesh>}
  </group>;
}
