import type { Point, Ring } from "@shared/geometry/types";

/** Analytic, counterclockwise XY boundaries. No mesh data enters this writer. */
export type StepSegment = { start: Point; end: Point } & (
  | { kind: "line" }
  | { kind: "arc"; center: Point; radius: number }
);
export type StepLoop = readonly StepSegment[];
export interface StepPocket {
  name: string;
  loop: StepLoop;
  floorZ: number;
}
export interface StepBody {
  id: string;
  name: string;
  loop: StepLoop;
  bottomZ: number;
  topZ: number;
  pockets?: readonly StepPocket[];
}

export function polygonStepLoop(ring: Ring): StepLoop {
  return ring.map((start, i) => ({ kind: "line", start, end: ring[(i + 1) % ring.length] }));
}

/** Four bounded arcs avoid periodic-face seam ambiguity in CAD importers. */
export function circleStepLoop(center: Point, radius: number): StepLoop {
  const points = [
    { x: center.x + radius, y: center.y }, { x: center.x, y: center.y + radius },
    { x: center.x - radius, y: center.y }, { x: center.x, y: center.y - radius },
  ];
  return points.map((start, i) => ({ kind: "arc", start, end: points[(i + 1) % 4], center, radius }));
}

export function roundedRectangleStepLoop(width: number, length: number, radius: number): StepLoop {
  const x = width / 2, y = length / 2, r = radius;
  const points = [
    { x: -x + r, y: -y }, { x: x - r, y: -y },
    { x, y: -y + r }, { x, y: y - r },
    { x: x - r, y }, { x: -x + r, y },
    { x: -x, y: y - r }, { x: -x, y: -y + r },
  ];
  const centers = [{ x: x - r, y: -y + r }, { x: x - r, y: y - r },
    { x: -x + r, y: y - r }, { x: -x + r, y: -y + r }];
  return points.map((start, i) => i % 2 === 0
    ? { kind: "line", start, end: points[(i + 1) % 8] }
    : { kind: "arc", start, end: points[(i + 1) % 8], center: centers[(i - 1) / 2], radius: r });
}

/** STEP Part 21 strings: apostrophes, literal backslashes, and Unicode UTF-16. */
function stepString(value: string): string {
  let encoded = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    encoded += code >= 32 && code <= 126 && code !== 92
      ? (code === 39 ? "''" : value[i])
      : `\\X2\\${code.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
  }
  return `'${encoded}'`;
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error("STEP requires finite dimensions.");
  const result = (Math.abs(value) < 1e-12 ? 0 : value).toPrecision(15);
  return result.replace(/e/i, "E");
}
type Vec3 = readonly [number, number, number];
type EdgeUse = { edge: string; forward: boolean };
interface Boundary {
  bottom: string[];
  top: string[];
  vertical: string[];
  segments: StepLoop;
  bottomZ: number;
}

/** Small AP214 B-rep serializer; modelling/feature resolution belongs upstream. */
class StepWriter {
  private entities: string[] = [];
  private points = new Map<string, string>();
  private vertices = new Map<string, string>();
  private directions = new Map<string, string>();

  add(entity: string): string {
    this.entities.push(entity);
    return `#${this.entities.length}`;
  }
  point(value: Vec3): string {
    const key = value.map(number).join(",");
    let ref = this.points.get(key);
    if (!ref) { ref = this.add(`CARTESIAN_POINT('',(${key}))`); this.points.set(key, ref); }
    return ref;
  }
  vertex(value: Vec3): string {
    const point = this.point(value);
    let ref = this.vertices.get(point);
    if (!ref) { ref = this.add(`VERTEX_POINT('',${point})`); this.vertices.set(point, ref); }
    return ref;
  }
  direction(value: Vec3): string {
    const length = Math.hypot(...value);
    if (length < 1e-10) throw new Error("STEP boundary has a zero-length edge.");
    const key = value.map(v => number(v / length)).join(",");
    let ref = this.directions.get(key);
    if (!ref) { ref = this.add(`DIRECTION('',(${key}))`); this.directions.set(key, ref); }
    return ref;
  }
  axis(origin: Vec3, normal: Vec3 = [0, 0, 1], x: Vec3 = [1, 0, 0]): string {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.point(origin)},${this.direction(normal)},${this.direction(x)})`);
  }
  line(a: Vec3, b: Vec3): string {
    const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const vector = this.add(`VECTOR('',${this.direction(delta)},1.)`);
    const curve = this.add(`LINE('',${this.point(a)},${vector})`);
    return this.add(`EDGE_CURVE('',${this.vertex(a)},${this.vertex(b)},${curve},.T.)`);
  }
  curve(segment: StepSegment, z: number): string {
    const a: Vec3 = [segment.start.x, segment.start.y, z];
    const b: Vec3 = [segment.end.x, segment.end.y, z];
    if (segment.kind === "line") return this.line(a, b);
    const circle = this.add(`CIRCLE('',${this.axis([segment.center.x, segment.center.y, z])},${number(segment.radius)})`);
    return this.add(`EDGE_CURVE('',${this.vertex(a)},${this.vertex(b)},${circle},.T.)`);
  }
  boundary(segments: StepLoop, bottomZ: number, topZ: number): Boundary {
    return {
      bottom: segments.map(s => this.curve(s, bottomZ)),
      top: segments.map(s => this.curve(s, topZ)),
      vertical: segments.map(s => this.line([s.start.x, s.start.y, bottomZ], [s.start.x, s.start.y, topZ])),
      segments, bottomZ,
    };
  }
  uses(edges: readonly string[], forward = true): EdgeUse[] {
    const uses = edges.map(edge => ({ edge, forward }));
    return forward ? uses : uses.reverse();
  }
  face(name: string, loops: readonly EdgeUse[][], surface: string, sameSense = true): string {
    const bounds = loops.map((uses, i) => {
      const edges = uses.map(({ edge, forward }) => this.add(`ORIENTED_EDGE('',*,*,${edge},${forward ? ".T." : ".F."})`));
      const loop = this.add(`EDGE_LOOP('',(${edges.join(",")}))`);
      return this.add(`${i === 0 ? "FACE_OUTER_BOUND" : "FACE_BOUND"}('',${loop},.T.)`);
    });
    return this.add(`ADVANCED_FACE(${stepString(name)},(${bounds.join(",")}),${surface},${sameSense ? ".T." : ".F."})`);
  }
  horizontal(name: string, z: number, loops: readonly EdgeUse[][], up = true): string {
    return this.face(name, loops, this.add(`PLANE('',${this.axis([0, 0, z])})`), up);
  }
  walls(boundary: Boundary, name: string, inward = false): string[] {
    const { segments, bottom, top, vertical, bottomZ } = boundary;
    return segments.map((segment, i) => {
      const j = (i + 1) % segments.length;
      let uses = [
        { edge: bottom[i], forward: true }, { edge: vertical[j], forward: true },
        { edge: top[i], forward: false }, { edge: vertical[i], forward: false },
      ];
      if (inward) uses = uses.reverse().map(use => ({ ...use, forward: !use.forward }));
      let surface: string;
      if (segment.kind === "arc") {
        surface = this.add(`CYLINDRICAL_SURFACE('',${this.axis([segment.center.x, segment.center.y, bottomZ])},${number(segment.radius)})`);
      } else {
        const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
        surface = this.add(`PLANE('',${this.axis([segment.start.x, segment.start.y, bottomZ], [dy, -dx, 0], [dx, dy, 0])})`);
      }
      return this.face(name, [uses], surface, !inward);
    });
  }
  solid(body: StepBody): string {
    if (body.topZ <= body.bottomZ) throw new Error("STEP body must have positive height.");
    const outer = this.boundary(body.loop, body.bottomZ, body.topZ);
    const pockets = (body.pockets ?? []).map(pocket => {
      if (pocket.floorZ < body.bottomZ || pocket.floorZ >= body.topZ) throw new Error("STEP pocket floor is outside its body.");
      return { pocket, boundary: this.boundary(pocket.loop, pocket.floorZ, body.topZ) };
    });
    const faces = [
      this.horizontal(body.name, body.topZ, [this.uses(outer.top), ...pockets.map(p => this.uses(p.boundary.top, false))]),
      this.horizontal(body.name, body.bottomZ, [this.uses(outer.bottom, false),
        ...pockets.filter(p => p.pocket.floorZ === body.bottomZ).map(p => this.uses(p.boundary.bottom))], false),
      ...this.walls(outer, body.name),
    ];
    for (const { pocket, boundary } of pockets) {
      faces.push(...this.walls(boundary, pocket.name, true));
      if (pocket.floorZ > body.bottomZ) faces.push(this.horizontal(pocket.name, pocket.floorZ, [this.uses(boundary.bottom)]));
    }
    const shell = this.add(`CLOSED_SHELL('',(${faces.join(",")}))`);
    return this.add(`MANIFOLD_SOLID_BREP(${stepString(body.name)},${shell})`);
  }
  document(bodies: readonly StepBody[], title: string): string {
    if (!bodies.length) throw new Error("STEP requires at least one body.");
    const application = this.add("APPLICATION_CONTEXT('automotive design')");
    this.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${application})`);
    const productContext = this.add(`PRODUCT_CONTEXT('',${application},'mechanical')`);
    const definitionContext = this.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${application},'design')`);
    const millimeters = this.add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))");
    const radians = this.add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))");
    const steradians = this.add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())");
    const uncertainty = this.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),${millimeters},'distance_accuracy_value','')`);
    const context = this.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${millimeters},${radians},${steradians})) REPRESENTATION_CONTEXT('',''))`);
    const origin = this.axis([0, 0, 0]);
    const product = (id: string, name: string, solid?: string) => {
      const item = this.add(`PRODUCT(${stepString(id)},${stepString(name)},'',(${productContext}))`);
      const formation = this.add(`PRODUCT_DEFINITION_FORMATION('','',${item})`);
      const definition = this.add(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
      const shape = this.add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
      const representation = this.add(`${solid ? "ADVANCED_BREP_SHAPE_REPRESENTATION" : "SHAPE_REPRESENTATION"}('',(${origin}${solid ? `,${solid}` : ""}),${context})`);
      this.add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);
      return { definition, representation };
    };
    const root = product("pocketry", title);
    for (const body of bodies) {
      const child = product(body.id, body.name, this.solid(body));
      const usage = this.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE(${stepString(body.id)},${stepString(body.name)},'',${root.definition},${child.definition},$)`);
      const shape = this.add(`PRODUCT_DEFINITION_SHAPE('','',${usage})`);
      const transform = this.add(`ITEM_DEFINED_TRANSFORMATION('','',${origin},${origin})`);
      const relationship = this.add(`(REPRESENTATION_RELATIONSHIP('','',${child.representation},${root.representation}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${transform}) SHAPE_REPRESENTATION_RELATIONSHIP())`);
      this.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${relationship},${shape})`);
    }
    return [
      "ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('Pocketry analytic CAD solids'),'2;1');",
      `FILE_NAME(${stepString(title)},'1970-01-01T00:00:00',(''),(''),'Pocketry','Pocketry','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));", "ENDSEC;", "DATA;",
      ...this.entities.map((entity, i) => `#${i + 1}=${entity};`), "ENDSEC;", "END-ISO-10303-21;", "",
    ].join("\n");
  }
}

/** AP214 assembly retaining named bodies and their Pocketry placement identifiers. */
export function writeStep(bodies: readonly StepBody[], title: string): string {
  return new StepWriter().document(bodies, title);
}
