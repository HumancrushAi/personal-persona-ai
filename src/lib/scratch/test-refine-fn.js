import { refinePromoPrompt } from "../prompt-refiner.server.js";

async function run() {
  process.env.XAI_API_KEY = "xai-zDNe74Ld5IxWgUrAlx2d6VfCUp4D8L1h5Zf1874D6mIrh8OWMGSE3pbbGXdqurNrtffKnzLf0aYVvQ5s";
  const p = "a goth woman, black bob haircut, black lipstick, green eyes, black silk robe over white lace lingerie, sitting on a balcony, daylight";
  console.log("Refining...");
  const refined = await refinePromoPrompt(p, false);
  console.log("Refined:", refined);
}

run();
