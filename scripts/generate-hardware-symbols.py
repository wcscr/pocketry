# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "gflabel @ git+https://github.com/ndevenish/gflabel@7c6bfbaf1e007d42ea82cf1e2d89563ab545ebe0",
#   "build123d==0.10.0",
#   "ocp-gordon==0.2.0",
# ]
# ///
"""Regenerate bundled vectors: uv run --locked scripts/generate-hardware-symbols.py.

GFLabel hardware artwork: Copyright (c) 2024 Nicholas Devenish, BSD-3-Clause.
See NOTICE and client/public/licenses/gflabel.txt. This maintenance-only tool
uses OpenCascade through GFLabel; the app continues to use Manifold exclusively.
"""
import json
import math
from pathlib import Path

from build123d import (BuildSketch, BuildLine, GeomType, GridLocations, Location,
                      Locations, Mode, Plane, Polyline, Rectangle, add, make_face, mirror)
from gflabel.fragments import fragment_from_spec

REVISION = "7c6bfbaf1e007d42ea82cf1e2d89563ab545ebe0"
SYMBOLS = [
    ("hex-nut", "Hex nut", "nut hexagonal fastener", "nut"),
    ("square-nut", "Square nut", "nut fastener", "square_nut"),
    ("t-slot-nut", "T-slot nut", "nut extrusion fastener", "tnut"),
    ("lock-nut", "Lock nut (side)", "nyloc nylon nut locking fastener", "locknut_profile"),
    ("washer", "Washer", "flat washer fastener", "washer"),
    ("lock-washer", "Lock washer", "split spring washer fastener", "lockwasher"),
    ("threaded-insert", "Threaded insert", "heat set brass insert fastener", "threaded_insert"),
    ("socket-bolt", "Socket-head bolt", "bolt screw cap socket fastener", "bolt(12,socket)"),
    ("pan-screw", "Pan-head screw", "bolt screw pan fastener", "bolt(12,pan)"),
    ("countersunk-screw", "Countersunk screw", "bolt screw flat head fastener", "bolt(12,countersunk)"),
    ("tapping-screw", "Self-tapping screw", "screw pointed wood tapping fastener", "bolt(12,countersunk,tapping)"),
    ("hex-head", "Hex head", "bolt screw hexagonal fastener", "hexhead"),
    ("hex-drive", "Hex socket", "allen hex drive bit socket", "head(hex)"),
    ("phillips", "Phillips", "cross phillips drive bit", "head(phillips)"),
    ("slotted", "Slotted", "flat blade slot drive bit", "head(slot)"),
    ("torx", "Torx", "star torx drive bit", "head(torx)"),
    ("security-torx", "Security Torx", "tamper resistant star torx drive bit", "head(torx,security)"),
    ("square-drive", "Square drive", "robertson square drive bit", "head(square)"),
]


def threaded_insert(height):
    """Adapted from GFLabel _fragment_insert at REVISION (BSD-3-Clause).

    Omit the tiny corner fillets: upstream fillet(line.vertices()) is unstable
    across runs with this OCCT version. Keep its profile and knurling cutouts.
    """
    with BuildSketch() as sketch:
        with BuildLine() as line:
            Polyline([(-3, 0), (-3, 1.25), (-4, 1.25), (-4, 3.75), (0, 3.75)])
            mirror(line.line, Plane.XZ)
            mirror(line.line, Plane.YZ)
        make_face()
        with Locations([(0, -3.76 - 2.5 / 2)]):
            Rectangle(6, 2.5)
        with BuildSketch(mode=Mode.PRIVATE) as trapezoid:
            with BuildLine():
                Polyline([(-1.074, 0.65), (-0.226, 0.65), (1.074, -0.65), (0.226, -0.65)], close=True)
            make_face()
        with GridLocations(1.625, 5, 4, 2):
            add(trapezoid.sketch, mode=Mode.SUBTRACT)
    return sketch.sketch.locate(Location((0, 2.5 / 2))).scale(height / 10)


def ring_points(wire, bounds, ccw):
    """Preserve edge endpoints; sample curves at <=0.04 mm at source height 6.

    Store y-up coordinates centered on the source's exact bounds, height 1.
    Normalize winding and rotate each ring to a stable starting vertex.
    """
    points = []
    for edge in wire.order_edges():
        count = 1 if edge.geom_type == GeomType.LINE else max(8, math.ceil(edge.length / 0.04))
        for i in range(count):
            p = edge.position_at(i / count)
            points.append((round((p.X - bounds.center().X) / bounds.size.Y, 6),
                           round((p.Y - bounds.center().Y) / bounds.size.Y, 6)))
    points = [p for i, p in enumerate(points) if p != points[i - 1]]
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1]))
    assert len(points) >= 3 and abs(area) > 1e-9
    if (area > 0) != ccw:
        points.reverse()
    first = min(range(len(points)), key=lambda i: points[i])
    points = points[first:] + points[:first]
    return [{"x": x, "y": y} for x, y in points]


def main():
    symbols = {}
    for key, name, keywords, fragment in SYMBOLS:
        sketch = threaded_insert(6) if fragment == "threaded_insert" else fragment_from_spec(fragment).render(6, 100, None)
        bounds = sketch.bounding_box()
        shapes = []
        for face in sketch.faces():
            holes = [ring_points(wire, bounds, False) for wire in face.inner_wires()]
            holes.sort(key=lambda ring: (ring[0]["x"], ring[0]["y"]))
            shapes.append({"outer": ring_points(face.outer_wire(), bounds, True), "holes": holes})
        shapes.sort(key=lambda shape: (shape["outer"][0]["x"], shape["outer"][0]["y"]))
        symbols[key] = {"name": name, "keywords": keywords, "fragment": fragment,
                        "sourceArea": round(sketch.area / bounds.size.Y ** 2, 8), "outline": shapes}
        print(f"{key}: {len(shapes)} shapes, {sum(len(s['holes']) for s in shapes)} holes")
    output = Path(__file__).resolve().parents[1] / "shared/gridfinity/hardware-symbols.json"
    # One entry per line keeps the asset compact while making symbol diffs reviewable.
    entries = [json.dumps(key) + ":" + json.dumps(value, separators=(",", ":")) for key, value in symbols.items()]
    output.write_text('{"source":"https://github.com/ndevenish/gflabel","revision":' + json.dumps(REVISION)
                      + ',"license":"BSD-3-Clause","symbols":{\n' + ',\n'.join(entries) + '\n}}\n')


if __name__ == "__main__":
    main()
