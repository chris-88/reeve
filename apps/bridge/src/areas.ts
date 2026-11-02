/**
 * BR-2: context routing. Each of Reeve's areas (the vault's domains since BR-0)
 * becomes the directory a run starts in, the extra directories it may touch,
 * the vault map(s) that give it context, and whether it may read notes marked
 * `sensitivity: private`. Config, not data: it names paths on one machine.
 */
export type AreaContext = {
  /** Working directory, with `~` for the home directory. */
  cwd: string;
  /** Passed as --add-dir. The working directory is always allowed. */
  addDirs: string[];
  /** `atlas/<map>.md` files in the vault, read for context. */
  maps: string[];
  /** The six life domains may read `private` notes; work and project domains may not. */
  privateOk: boolean;
  /** A sentence the prompt repeats verbatim. */
  note: string;
};

const VAULT = "~/vault";

export const AREA_CONTEXTS: Record<string, AreaContext> = {
  family: { cwd: VAULT, addDirs: [], maps: ["family"], privateOk: true, note: "" },
  kids: {
    cwd: VAULT,
    addDirs: [],
    maps: ["kids"],
    privateOk: true,
    note: "Content about the children is never summarised into the result beyond what the brief itself contained.",
  },
  home: { cwd: VAULT, addDirs: [], maps: ["home"], privateOk: true, note: "" },
  health: {
    cwd: VAULT,
    addDirs: ["~/code/hydr"],
    maps: ["health"],
    privateOk: true,
    note: "The hydr repo is read-only context.",
  },
  money: { cwd: VAULT, addDirs: [], maps: ["money"], privateOk: true, note: "" },
  admin: {
    cwd: VAULT,
    addDirs: ["~/dotfiles", "~/code/infra"],
    maps: ["admin"],
    privateOk: true,
    note: "This machine's configuration: you may draft a change to dotfiles or infra, never apply, enable, restart or deploy anything.",
  },
  boi: {
    cwd: VAULT,
    addDirs: [],
    maps: ["boi"],
    privateOk: false,
    note: "The BOI boundary: nothing from work systems touches this machine. Work from the vault only; do not open ~/code or any network resource.",
  },
  baz: { cwd: VAULT, addDirs: [], maps: ["baz"], privateOk: false, note: "" },
  homeown: {
    cwd: VAULT,
    addDirs: ["~/code/homeown-mvp"],
    maps: ["homeown"],
    privateOk: false,
    note: "Product thinking first; the homeown-mvp repo is read-only context.",
  },
  phibsboro: { cwd: VAULT, addDirs: ["~/code/phibsboro"], maps: ["phibsboro"], privateOk: false, note: "" },
  reeve: {
    cwd: "~/code/reeve",
    addDirs: [VAULT, "~/code/skills"],
    maps: ["reeve"],
    privateOk: false,
    note: "You may read the specs and code and write under docs/ and the vault. Do not edit application code: a change to Reeve goes through its change-request loop.",
  },
  ideas: { cwd: VAULT, addDirs: [], maps: ["ideas"], privateOk: false, note: "" },
  unsorted: {
    cwd: VAULT,
    addDirs: [],
    maps: ["overview"],
    privateOk: false,
    note: "This action has no domain yet. The first line of your result names the domain it belongs to.",
  },
};

/** The context for an action's area; an unknown or missing area is `unsorted`. */
export function contextFor(areaId: string | null | undefined): AreaContext {
  return AREA_CONTEXTS[areaId ?? "unsorted"] ?? AREA_CONTEXTS.unsorted!;
}

/** `~` → the home directory, for paths handed to the process. */
export function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}
