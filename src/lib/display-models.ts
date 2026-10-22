/**
 * Presentation order for public model surfaces.
 *
 * This deliberately does not change database `sort_order`: that column is
 * still used by back-office tooling and voice fallbacks. It only controls the
 * first models people see in discovery, creator, and authentication UI.
 */
export type DisplayModel = {
  name: string;
  gender?: string | null;
};

const LEAD_NAMES = [
  "Raven",
  "Skye",
  "Aria",
  "Sofia",
  "Kira",
  "Harley",
  "Vex",
  "Chloe",
  "Ravenna",
  "Lilith",
  "Putri",
  "Airi",
  "Mina",
  "Naomi",
  "Hana",
] as const;

// These identities remain available everywhere, but never lead a mixed
// gallery. Male identities are placed after the women on mixed public rails.
const TRAILING_NAMES = [
  "Vanessa",
  "Sabrina",
  "Bianca",
  "Scarlett",
  "Ruby",
  "Lola",
  "Monica",
  "Diane",
  "Keisha",
  "Carmen",
] as const;

function normalizedName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase();
}

export function displayModelRank(model: DisplayModel) {
  const name = normalizedName(model.name);
  const leadIndex = LEAD_NAMES.findIndex((candidate) => normalizedName(candidate) === name);
  if (leadIndex >= 0) return leadIndex;

  const gender = (model.gender ?? "").toLocaleLowerCase();
  if (gender === "male" || gender === "trans-male") return 900;

  if (TRAILING_NAMES.some((candidate) => normalizedName(candidate) === name)) return 700;
  return 100 + name.charCodeAt(0);
}

export function orderModelsForDisplay<T extends DisplayModel>(models: readonly T[]) {
  return [...models].sort((a, b) => {
    const rank = displayModelRank(a) - displayModelRank(b);
    return rank || a.name.localeCompare(b.name);
  });
}
