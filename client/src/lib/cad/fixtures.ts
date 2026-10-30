import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";

const rect=(id:string,w:number,l:number)=>createBasicPocket("rectangle",{x:-w/2,y:-l/2},{x:w/2,y:l/2},id)!;
const circle=(id:string,r:number)=>createBasicPocket("circle",{x:0,y:0},{x:r,y:0},id)!;
const project=(spec:ProjectDoc["spec"],shapes:ProjectDoc["shapes"]=[],cutouts:ProjectDoc["cutouts"]=[],fingerHoles:ProjectDoc["fingerHoles"]=[]):ProjectDoc=>({schemaVersion:PROJECT_SCHEMA_VERSION,spec,shapes,cutouts,fingerHoles});

/** One shared authored-data fixture corpus for both isolated integrations. */
export function cadInvestigationFixtures():Record<string,ProjectDoc> {
  const rectangle=rect("rectangle",20,14),round=circle("circle",6);
  const mixed=project(parseBinSpec({gridX:3,gridY:2,heightUnits:4}),[rectangle.shape,round.shape],[
    {...rectangle.cutout,name:"Clé Ø — duplicate",position:{x:-20,y:0},rotationDeg:32,mirrored:true,depth:{mode:"mm",value:12},cornerRoundMm:1,bottomFilletMm:0.8,topFilletMm:0.8},
    {...round.cutout,name:"Clé Ø — duplicate",position:{x:20,y:6},depth:{mode:"through"}},
  ]);
  const contour:TracedShape={id:"contour",name:"Concave authored boundary",source:"trace",sourceMmPerPx:1,pointCount:10,
    outlineMm:[{outer:[{x:-10,y:-10},{x:10,y:-10},{x:10,y:0},{x:0,y:0},{x:0,y:10},{x:-10,y:10}],holes:[[{x:-7,y:-7},{x:-7,y:-3},{x:-3,y:-3},{x:-3,y:-7}]]}],
    bboxMm:{minX:-10,minY:-10,maxX:10,maxY:10}};
  const ellipse=circle("ellipse",7);
  const concave=project(parseBinSpec({gridX:3,gridY:2,heightUnits:4,flatBottom:true,lip:"none"}),[contour,ellipse.shape],[
    parseCutoutPlacement({id:"concave",shapeId:contour.id,name:"Concavity with hole",position:{x:-15,y:0},depth:{mode:"mm",value:10},clearanceMm:0.2,cornerRoundMm:0.7,bottomFilletMm:0.4,topFilletMm:0.5}),
    {...ellipse.cutout,id:"ellipse",name:"Scaled circle",scaleX:1.4,scaleY:0.7,position:{x:0,y:-6},depth:{mode:"mm",value:12}},
  ]);
  const split=rect("split",20,12),raised=circle("raised",4);
  const tilted=project(parseBinSpec({gridX:3,gridY:3,heightUnits:5,flatBottom:true,lip:"none"}),[split.shape,raised.shape],[
    {...split.cutout,name:"Tilted split source",tilt:{xDeg:25,yDeg:15},rotationDeg:18,elevationMm:7,insertionMode:"axis",
      split:{boundary:[{x:-10,y:0},{x:10,y:0}],depths:[{mode:"mm",value:8},{mode:"mm",value:14}]},
      clearanceMm:0.1,cornerRoundMm:0.7,bottomFilletMm:0.6,topFilletMm:0},
    {...raised.cutout,name:"Raised finite source",elevationMm:60,depth:{mode:"through",sourceDepthMm:9}},
  ]);
  const pocket=circle("irregular-circle",6);
  const irregular=project(parseBinSpec({gridX:2,gridY:2,heightUnits:4,flatBottom:true,footprint:{kind:"custom",cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]},
    surfaceTexts:[surfaceTextSchema.parse({id:"text",name:"CAD label",text:"CAD",position:{x:21,y:-21},sizeMm:6,font:"sans"})]}),[pocket.shape],[
    {...pocket.cutout,position:{x:-21,y:-21},depth:{mode:"mm",value:12}},
  ],[fingerHoleSchema.parse({id:"thumb",name:"Thumb access",kind:"straight",center:{x:-12,y:-21},diameterMm:10,depthMm:14,topFilletMm:0.4,bottomFilletMm:0.5})]);
  return {"standard-solid":project(parseBinSpec({gridX:1,gridY:1,heightUnits:3})),"standard-hollow":project(parseBinSpec({gridX:2,gridY:1,heightUnits:3,fill:"none"})),mixed,concave,tilted,irregular};
}
