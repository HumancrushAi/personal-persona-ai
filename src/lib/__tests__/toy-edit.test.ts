import { describe, expect, it } from "vitest";
import { FACEID_WORKFLOW, toyDirectWorkflow, withFaceSwap, withToyEdit, withoutToyEdit } from "../comfy";
import { TOYS, TOY_EDITS } from "../toys";

const edit = (template: string) => withToyEdit(template, { toyImageName: "toy-edit.png", instruction: "Edit image 1.", seed: 7 });

describe("toy edit pass", () => {
  it("edits the render before the face swap, so her face is restored after it", () => {
    const swapped = JSON.parse(withFaceSwap(FACEID_WORKFLOW));
    const g = JSON.parse(edit(withFaceSwap(FACEID_WORKFLOW)));
    expect(g["30"].inputs.image).toEqual(["83", 0]);
    expect(g["81"].inputs.pixels).toEqual(swapped["30"].inputs.image);
    expect(g["77"].inputs.image2).toEqual(["76", 0]);
    expect(g["76"].inputs.image).toBe("toy-edit.png");
    expect(g["82"].inputs).toMatchObject({ steps: 4, cfg: 1, seed: 7 });
  });

  it("comes out whole for the serverless worker, which has no edit model", () => {
    const plain = JSON.parse(withFaceSwap(FACEID_WORKFLOW));
    const input = { workflow: JSON.parse(edit(withFaceSwap(FACEID_WORKFLOW))), images: [{ name: "reference.png" }, { name: "toy-edit.png" }] };
    const out = withoutToyEdit(input) as { workflow: Record<string, any>; images: { name: string }[] };
    expect(out.workflow).toEqual(plain);
    expect(out.images.map((i) => i.name)).toEqual(["reference.png"]);
  });

  it("leaves a job without the pass untouched", () => {
    const input = { workflow: JSON.parse(FACEID_WORKFLOW) };
    expect(withoutToyEdit(input)).toBe(input);
  });

  it("makes a direct picture from her portrait and the toy photo, face swapped last", () => {
    const g = JSON.parse(toyDirectWorkflow({ toyImageName: "toy-edit.png", instruction: "A photo.", seed: 3, width: 768, height: 768 }));
    expect(g["10"].inputs.image).toBe("{{REFERENCE_IMAGE}}");
    expect(g["77"].inputs).toMatchObject({ image1: ["10", 0], image2: ["76", 0], prompt: "A photo." });
    expect(g["81"].inputs).toMatchObject({ width: 768, height: 768 });
    expect(g["30"].inputs).toEqual({ image: ["83", 0], source: ["10", 0] });
    expect(g["9"].inputs.images).toEqual(["30", 0]);
  });

  it("hands the serverless worker the ordinary job a direct one carries", () => {
    const plain = { workflow: JSON.parse(FACEID_WORKFLOW) };
    expect(withoutToyEdit({ workflow: {}, fallbackInput: plain })).toBe(plain);
  });

  it("has an instruction for every chest toy", () => {
    for (const toy of TOYS) expect(TOY_EDITS[toy.id]?.edit, toy.id).toBeTruthy();
  });
});
