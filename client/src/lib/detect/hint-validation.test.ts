import { expect,it } from "vitest";
import { validateDetectionHints } from "./hint-validation";
const outline=[{outer:[{x:0,y:0},{x:30,y:0},{x:30,y:30},{x:20,y:30},{x:20,y:10},{x:10,y:10},{x:10,y:30},{x:0,y:30}],holes:[]}];
it("rejects a lost stroke middle even if both endpoints survived",()=>{
 expect(()=>validateDetectionHints(outline,[{kind:"tool",points:[{x:5,y:20},{x:25,y:20}],radius:1}])).toThrow(/preserve/);
 expect(()=>validateDetectionHints(outline,[{kind:"tool",points:[{x:5,y:5},{x:25,y:5}],radius:1}])).not.toThrow();
});
it("rejects paper marks filled by outside-only hole removal",()=>{
 expect(()=>validateDetectionHints(outline,[{kind:"paper",points:[{x:5,y:5}],radius:1}])).toThrow(/paper stroke/);
});
