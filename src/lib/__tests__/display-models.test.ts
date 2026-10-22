import { describe, expect, it } from "vitest";
import { orderModelsForDisplay } from "../display-models";

describe("orderModelsForDisplay", () => {
  it("puts the featured discovery identities before established and male identities", () => {
    const names = orderModelsForDisplay([
      { name: "Vanessa", gender: "female" },
      { name: "Ethan", gender: "male" },
      { name: "Sofia", gender: "female" },
      { name: "Raven", gender: "female" },
      { name: "Sabrina", gender: "female" },
    ]).map((model) => model.name);

    expect(names).toEqual(["Raven", "Sofia", "Sabrina", "Vanessa", "Ethan"]);
  });

  it("keeps the source list unchanged", () => {
    const source = [{ name: "Vanessa" }, { name: "Raven" }];
    orderModelsForDisplay(source);
    expect(source.map((model) => model.name)).toEqual(["Vanessa", "Raven"]);
  });
});
