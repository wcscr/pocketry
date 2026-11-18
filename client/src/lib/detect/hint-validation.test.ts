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
it("rejects a hole left inside an Add loop even when the entire brush line is included", () => {
  const square = (low: number, high: number) => [{ x: low, y: low }, { x: high, y: low }, { x: high, y: high }, { x: low, y: high }];
  const shape = [{ outer: square(0, 50), holes: [square(20, 25).reverse()] }];
  const hint = { kind: "tool" as const, points: square(10, 40), radius: 1 };
  expect(() => validateDetectionHints(shape, [hint])).not.toThrow();
  expect(() => validateDetectionHints(shape, [{ ...hint, fill: true }])).toThrow(/fill the entire loop/);
});
