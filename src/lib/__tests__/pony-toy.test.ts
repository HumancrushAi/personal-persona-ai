import { describe, expect, it } from "vitest";
import { toyPonyWorkflow } from "../comfy";
import { propIsInserted } from "../props";

describe("inside-toy Pony workflow", () => {
  it("keeps the identity reference, product edit chain, and final face swap", () => {
    const graph = JSON.parse(toyPonyWorkflow({
      positive: "adult woman, glass dildo inside",
      negative: "extra hands",
      seed: 41,
      edits: [
        { instruction: "Make the toy glass", imageName: "toy-edit.png" },
        { instruction: "Keep only her", imageName: "{{REFERENCE_IMAGE}}" },
      ],
    })) as Record<string, { class_type: string; inputs?: Record<string, unknown> }>;

    expect(graph["10"].inputs?.image).toBe("{{REFERENCE_IMAGE}}");
    expect(graph["70"].class_type).toBe("CheckpointLoaderSimple");
    expect(graph["101"].class_type).toBe("TextEncodeQwenImageEditPlus");
    expect(graph["111"].class_type).toBe("TextEncodeQwenImageEditPlus");
    expect(graph["30"].inputs?.source).toEqual(["10", 0]);
    expect(graph["9"].inputs?.images).toEqual(["30", 0]);
  });

  it("treats riding a named dildo as insertion but not merely holding it", () => {
    expect(propIsInserted("send me a photo riding the big black dildo")).toBe(true);
    expect(propIsInserted("ride your glass dildo for me")).toBe(true);
    expect(propIsInserted("show me holding the dildo")).toBe(false);
  });
});
