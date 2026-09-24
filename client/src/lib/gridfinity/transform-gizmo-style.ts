import { CanvasTexture, CatmullRomCurve3, Line, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Sprite, SpriteMaterial, TubeGeometry, Vector3 } from "three";

type GizmoMode = "translate" | "rotate" | "scale";
/** Three's gizmo stores its visible handles and ray-picking handles separately. */
type GizmoHandleGroups = { gizmo: Record<GizmoMode, Object3D>; picker: Record<GizmoMode, Object3D> };

/** Replace one-pixel wire handles with solid, softly colored geometry while
 * retaining Three's tested ray pickers and drag math. Restore before disposal. */
export function styleTransformGizmo(control: Object3D): () => void {
  const removed: { parent: Object3D; child: Object3D }[] = [];
  const replacements: Mesh[] = [];
  const labels: Sprite[] = [];
  const labelPickers: { parent: Object3D; mesh: Mesh<SphereGeometry, MeshBasicMaterial> }[] = [];
  const pickerGroups = new Map<Object3D, Object3D>();
  control.traverse(child => {
    if (child.type !== "TransformControlsGizmo") return;
    const { gizmo, picker } = child as Object3D & GizmoHandleGroups;
    for (const mode of ["translate", "rotate", "scale"] as const) pickerGroups.set(gizmo[mode], picker[mode]);
  });
  const colors: Record<string, string> = { X: "#ef6262", Y: "#36b58a", Z: "#548fff", XY: "#d4b45c", XZ: "#bf8ee7", YZ: "#4fbfc8" };
  control.traverse(child => {
    if (["E", "XYZE", "XYZ"].includes(child.name) && child.parent) removed.push({ parent: child.parent, child });
    // Labeled grips replace the legacy diamonds; leaving both obscures the letters.
    if (child instanceof Mesh && child.geometry.type === "OctahedronGeometry" && colors[child.name] && child.parent) {
      removed.push({ parent: child.parent, child }); return;
    }
    if (child instanceof Mesh && colors[child.name] && child.material instanceof MeshBasicMaterial && child.material.opacity > 0.1) {
      child.material.color.set(colors[child.name]);
    }
    if (!(child instanceof Line) || !colors[child.name] || !child.parent) return;
    const position = child.geometry.getAttribute("position");
    const points = Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i));
    if (points.length < 2) return;
    const tube = new Mesh(new TubeGeometry(new CatmullRomCurve3(points), points.length > 3 ? 96 : 1, 0.016, 8, false),
      new MeshBasicMaterial({ color: colors[child.name], transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false }));
    tube.name = child.name;
    tube.renderOrder = 1000;
    // The gizmo updates the pose each frame; the baked geometry is already in
    // the axis frame. Copy only the helper tag used by its visibility logic.
    if ("tag" in child) Object.assign(tube, { tag: child.tag });
    if (child.name.length === 1) {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d");
      if (context) {
        context.beginPath(); context.arc(64, 64, 56, 0, Math.PI * 2);
        context.fillStyle = colors[child.name]; context.fill();
        context.lineWidth = 7; context.strokeStyle = "#ffffff"; context.stroke();
        context.font = "bold 64px system-ui"; context.textAlign = "center"; context.textBaseline = "middle";
        context.fillStyle = "#102030"; context.fillText(child.name, 64, 66);
        const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false, depthWrite: false, toneMapped: false }));
        sprite.position.copy(points[points.length > 3 ? Math.floor(points.length / 2) : points.length - 1]);
        if (points.length <= 3) sprite.position.multiplyScalar(1.2);
        sprite.scale.setScalar(0.28); sprite.renderOrder = Infinity;
        sprite.raycast = () => {}; tube.add(sprite); labels.push(sprite);
        const pickerGroup = pickerGroups.get(child.parent);
        if (pickerGroup) {
          // Bake the label's local center into a slightly padded spherical target.
          // Giving it the same axis name lets TransformControls apply the same
          // camera-facing pose, visibility, axis flips, scaling and drag behavior.
          const mesh = new Mesh(new SphereGeometry(0.16, 16, 12).translate(sprite.position.x, sprite.position.y, sprite.position.z),
            new MeshBasicMaterial({ visible: false }));
          mesh.name = child.name;
          labelPickers.push({ parent: pickerGroup, mesh });
        }
      }
    }
    removed.push({ parent: child.parent, child });
    replacements.push(tube);
  });
  removed.forEach(({ parent, child }) => {
    child.removeFromParent();
    const replacement = replacements.find(mesh => mesh.name === child.name && !mesh.parent);
    if (child instanceof Line && replacement) parent.add(replacement);
  });
  labelPickers.forEach(({ parent, mesh }) => parent.add(mesh));
  return () => {
    labelPickers.forEach(({ mesh }) => { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); });
    labels.forEach(label => { label.material.map?.dispose(); label.material.dispose(); });
    replacements.forEach(mesh => { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); });
    removed.forEach(({ parent, child }) => parent.add(child));
  };
}
