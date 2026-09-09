// Pocketry H2D photo board — AGPL-3.0-only. Dimensions are millimetres.
// Open this file beside calibration.scad. See README.md for printing/assembly.
// Calibration data is generated from the same layout Pocketry detects.
include <calibration.scad>

// Export base alone in green; export both marker colors together as one object.
part = "assembly"; // [assembly,base,markers-white,markers-black,fit-coupon]
// Eight removable, two-layer adhesion pads. Included in the checked envelope.
adhesion_tabs = true;
// Per-side fit allowance only; this does not move the marker centers.
tile_clearance = board_tile_clearance;

$fn = 64;
eps = 0.01;
assert(tile_clearance >= 0.05 && tile_clearance <= 0.3,
       "Keep the tile fit close enough to preserve calibration.");
assert(board_width + 2 * (adhesion_radius - adhesion_inset) <= 325);
assert(board_height + 2 * (adhesion_radius - adhesion_inset) <= 320);
assert(board_thickness - tile_thickness >= 3,
       "Retain a substantial floor under the marker pockets.");

// XY coordinates are ordinary CAD coordinates; photo Y increases downward.
function board_center(i) = [marker_centers[i][0], board_height-marker_centers[i][1]];
function print_center(i) = [24 + (i % 2) * 48, 24 + floor(i / 2) * 48];
function white_bit(i, row, col) = marker_bits[i][row][col] == 1;

module rounded_outline() {
    translate([board_corner_radius, board_corner_radius])
        offset(r=board_corner_radius)
            square([board_width-2*board_corner_radius,
                    board_height-2*board_corner_radius]);
}

// The clipped top-left corner keys tile orientation. The whole 30 mm marker
// and its 5 mm white quiet zone along each edge remain unobstructed.
module tile_outline() {
    a = tile_size/2;
    polygon([[-a,-a], [a,-a], [a,a], [-a+tile_key_chamfer,a],
             [-a,a-tile_key_chamfer]]);
}

module pocket(i) {
    p = board_center(i);
    translate([p[0], p[1], board_thickness-tile_thickness])
        linear_extrude(tile_thickness+eps)
            offset(delta=tile_clearance) tile_outline();
}

module adhesion_pads() {
    // Four corner pads plus four midpoint pads resist corner/edge lifting.
    for (p = [[adhesion_inset,adhesion_inset],
              [board_width-adhesion_inset,adhesion_inset],
              [board_width-adhesion_inset,board_height-adhesion_inset],
              [adhesion_inset,board_height-adhesion_inset],
              [board_width/2,adhesion_inset],
              [board_width/2,board_height-adhesion_inset],
              [adhesion_inset,board_height/2],
              [board_width-adhesion_inset,board_height/2]])
        translate([p[0],p[1],0]) cylinder(r=adhesion_radius,h=adhesion_thickness);
}

module base() {
    union() {
        difference() {
            // Uniform 6 mm envelope: slice with balanced skins and sparse infill.
            // No underside cavities or unsupported roofs to telegraph onto the face.
            linear_extrude(board_thickness) rounded_outline();
            for (i=[0:3]) {
                pocket(i);
                p=board_center(i);
                // Hidden pocket labels identify the correct tile during assembly.
                translate([p[0],p[1],board_thickness-tile_thickness-0.4])
                    linear_extrude(0.4+eps)
                        text(str(marker_ids[i]),size=5,halign="center",valign="center");
            }
        }
        if (adhesion_tabs) adhesion_pads();
    }
}

module tile_body(i) {
    difference() {
        union() {
            // A 0.3 mm lower-edge chamfer reduces elephant-foot interference.
            hull() {
                linear_extrude(0.01) offset(delta=-0.3) tile_outline();
                translate([0,0,0.3]) linear_extrude(0.01) tile_outline();
            }
            translate([0,0,0.3]) linear_extrude(tile_thickness-0.3) tile_outline();
        }
        // Read from underneath, so the hidden ID is mirrored in top coordinates.
        translate([0,0,-eps]) mirror([1,0,0]) linear_extrude(0.4+eps)
            text(str(marker_ids[i]),size=5,halign="center",valign="center");
    }
}

module marker_black_2d(i) {
    cell=marker_size/6;
    // A single connected border, plus the black data cells. Offset/close by
    // 0.01 mm joins diagonal cell contacts without changing the outer square.
    offset(delta=-0.01) offset(delta=0.01)
        union() {
            difference() {
                square([marker_size,marker_size],center=true);
                square([marker_size-2*cell,marker_size-2*cell],center=true);
            }
            for(row=[0:3],col=[0:3]) if (!white_bit(i,row,col))
                translate([-marker_size/2+(col+1)*cell,
                           marker_size/2-(row+2)*cell]) square([cell,cell]);
        }
}

module marker_black(i) {
    // The solid 0.4 mm black underlay connects every black cell. White cells
    // receive 1.2 mm of opaque white above it to limit show-through.
    union() {
        translate([-marker_size/2,-marker_size/2,0.8])
            cube([marker_size,marker_size,0.4]);
        translate([0,0,1.2]) linear_extrude(tile_thickness-1.2)
            marker_black_2d(i);
    }
}

module marker_white(i) {
    difference() { tile_body(i); marker_black(i); }
}

module marker_plate(is_black) {
    for (i=[0:3]) {
        p=print_center(i);
        translate([p[0],p[1],0])
            if(is_black) marker_black(i); else marker_white(i);
    }
}

module fit_coupon() {
    // Print before the large base. This reproduces one pocket/floor exactly.
    p=board_center(0);
    intersection() {
        base();
        translate([p[0]-24,p[1]-24,0]) cube([48,48,board_thickness]);
    }
}

if (part=="base") color("#32BC46") base();
else if (part=="markers-white") color("white") marker_plate(false);
else if (part=="markers-black") color("black") marker_plate(true);
else if (part=="fit-coupon") color("#32BC46") fit_coupon();
else if (part=="assembly") {
    color("#32BC46") render() base();
    for(i=[0:3]) {
        p=board_center(i);
        translate([p[0],p[1],board_thickness-tile_thickness]) {
            color("white") render() marker_white(i);
            color("black") render() marker_black(i);
        }
    }
} else assert(false,"Unknown part selection");
