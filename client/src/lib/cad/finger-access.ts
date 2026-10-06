import { effectiveFingerHoleDepthMm, effectiveFingerHoleTopFilletMm, effectiveFingerHoleBottomFilletMm, effectiveFingerHoleCornerRoundMm,
  isElongatedFingerHole, hasFlatFingerHoleBottom, hasFlatFingerHoleEnds, elongatedFingerHoleEndpoints, flatEndedScoopRadiusMm, type FingerHole } from "@shared/gridfinity/cutout";
import { CadContext, type CadShape, type CadProfile } from "./adapter";
import { clipBelow, clipAbove, mouthFlare } from "./construction";
import { roundPocketBottom } from "./profile-operations";

export function buildCadFingerAccess(c:CadContext,hole:FingerHole,fillZ:number,binTop:number):CadShape {
  const depth=effectiveFingerHoleDepthMm(hole),r=hole.diameterMm/2,elongated=isElongatedFingerHole(hole),flatEnds=hasFlatFingerHoleEnds(hole),flatBottom=hasFlatFingerHoleBottom(hole);
  const length=elongatedFingerHoleEndpoints(hole).lengthMm;
  const profile:CadProfile=!elongated?{kind:"ellipse",rx:r,ry:r}:{kind:"rounded-rectangle",width:length,length:hole.diameterMm,radius:flatEnds?effectiveFingerHoleCornerRoundMm(hole):r};
  let cutter:CadShape;
  if(flatBottom) {
    cutter=roundPocketBottom(c,c.extrude(profile,fillZ-depth,binTop+1),fillZ-depth,effectiveFingerHoleBottomFilletMm(hole));
  }else {
    const sphereR=depth<r?flatEndedScoopRadiusMm(hole):r;
    const centerZ=fillZ-depth+sphereR;
    if(!elongated) {
      const sphere=c.move(c.own(c.own(new c.oc.BRepPrimAPI_MakeSphere(sphereR)).Shape()),{x:0,y:0,z:centerZ});
      const cap=clipBelow(c,sphere,fillZ,"finger scoop surface cap");
      const shaftBottom=Math.min(fillZ,centerZ);
      const mouth=c.extrude(profile,shaftBottom,binTop+1);
      cutter=c.boolean("fuse",cap,mouth,"analytic spherical finger scoop");
    }else {
      const halfSpan=(length-(flatEnds?0:hole.diameterMm))/2;
      let trough=c.own(c.own(new c.oc.BRepPrimAPI_MakeCylinder(sphereR,halfSpan*2)).Shape());
      trough=c.move(c.rotate(trough,{x:0,y:1,z:0},90),{x:-halfSpan,y:0,z:centerZ});
      if(!flatEnds)for(const x of [-halfSpan,halfSpan])trough=c.boolean("fuse",trough,c.move(c.own(c.own(new c.oc.BRepPrimAPI_MakeSphere(sphereR)).Shape()),{x,y:0,z:centerZ}),"rounded scoop ends");
      trough=clipBelow(c,trough,fillZ,"elongated scoop surface cap");
      // Shallow spherical/cylindrical cuts are clipped to the authored mouth.
      const mouth=c.extrude(profile,fillZ-depth,binTop+1);
      trough=c.boolean("common",trough,mouth,"finger scoop mouth width");
      const shaft=c.extrude(profile,Math.min(fillZ,centerZ),binTop+1);
      cutter=c.boolean("fuse",trough,shaft,"analytic elongated scoop");
    }
  }
  const radius=effectiveFingerHoleTopFilletMm(hole);
  if(radius>0&&(!flatBottom&&depth<r+radius))throw new Error("Shallow curved finger-access rounding needs a tangent-profile sweep; this requested operation is not supported yet");
  cutter=mouthFlare(c,cutter,fillZ,binTop+1,radius);
  cutter=c.rotate(cutter,{x:0,y:0,z:1},hole.rotationDeg??0);
  return c.move(cutter,{...hole.center,z:0});
}
