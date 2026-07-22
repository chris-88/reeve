import { z } from "zod";

export const CAPTURE_STATUSES = ["queued", "processing", "done", "failed"] as const;
export const CAPTURE_SOURCES = ["text"] as const;

export const CaptureStatus = z.enum(CAPTURE_STATUSES);
export type CaptureStatus = z.infer<typeof CaptureStatus>;

export const CaptureSource = z.enum(CAPTURE_SOURCES);
export type CaptureSource = z.infer<typeof CaptureSource>;

/** The area a capture could not be confidently placed in. Never fail — route here. */
export const UNSORTED_AREA_ID = "unsorted";

export const Area = z.object({
  id: z.string(),
  /** Owner-scoped since migration 0003. `id` is unique per owner, not globally. */
  owner_id: z.uuid(),
  label: z.string(),
  classifier_hint: z.string(),
  colour: z.string(),
  sort_order: z.number().int(),
  active: z.boolean(),
});
export type Area = z.infer<typeof Area>;

/**
 * Note the absence of `commitments`.
 *
 * It used to live here as a `string[]`, which meant the one extraction that
 * implies an action was the least usable thing the model produced: no due
 * date, no completion, unqueryable inside jsonb. It is now a table, and the
 * model returns it as `TriageResult.commitments` instead. Captures triaged
 * before that change still carry the key in their stored jsonb; nothing reads
 * it, and `scripts/backfill-commitments.mjs` lifts it into rows.
 */
export const Entities = z.object({
  people: z.array(z.string()),
  dates: z.array(z.string()),
  amounts: z.array(z.string()),
  orgs: z.array(z.string()),
});
export type Entities = z.infer<typeof Entities>;

export const EMPTY_ENTITIES: Entities = {
  people: [],
  dates: [],
  amounts: [],
  orgs: [],
};

export const COMMITMENT_STATUSES = ["open", "done", "dropped"] as const;
export const CommitmentStatus = z.enum(COMMITMENT_STATUSES);
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;

export const COMMITMENT_ORIGINS = ["model", "user"] as const;
export const CommitmentOrigin = z.enum(COMMITMENT_ORIGINS);
export type CommitmentOrigin = z.infer<typeof CommitmentOrigin>;

export const Commitment = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  capture_id: z.uuid(),
  area_id: z.string().nullable(),
  text: z.string(),
  /** The date phrase as spoken — "next Tuesday" — kept alongside the resolution. */
  due_text: z.string().nullable(),
  due_at: z.string().nullable(),
  status: CommitmentStatus,
  completed_at: z.string().nullable(),
  origin: CommitmentOrigin,
  fingerprint: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Commitment = z.infer<typeof Commitment>;

export const Capture = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  source: CaptureSource,
  raw_text: z.string(),
  status: CaptureStatus,
  area_id: z.string().nullable(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  entities: Entities.nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  corrected_area_id: z.string().nullable(),
  corrected_at: z.string().nullable(),
});
export type Capture = z.infer<typeof Capture>;

/**
 * What the triage model must return.
 *
 * Every field is required and objects are closed, because this is fed to
 * structured outputs (`output_config.format`) which requires `required` on all
 * properties and `additionalProperties: false`. Empty entity arrays are valid
 * output and must not be treated as failure.
 */
export const ExtractedCommitment = z.object({
  text: z
    .string()
    .describe("One thing Chris said he would do, phrased as an action he takes."),
  due_text: z
    .string()
    .nullable()
    .describe(
      "The date phrase exactly as it appears in the capture — 'Thursday', 'end of the month'. Null if no date is mentioned.",
    ),
  due_at: z
    .string()
    .nullable()
    .describe(
      "due_text resolved against the capture's date, as YYYY-MM-DD. Null if it cannot be worked out.",
    ),
});
export type ExtractedCommitment = z.infer<typeof ExtractedCommitment>;

export const TriageResult = z.object({
  area_id: z.string().describe("The id of the best-matching area. Use 'unsorted' if unsure."),
  title: z.string().describe("A title of at most 8 words. No trailing punctuation."),
  summary: z.string().describe("At most two sentences summarising the capture."),
  entities: Entities,
  commitments: z
    .array(ExtractedCommitment)
    .describe("Things Chris said he would do. An empty array is correct when there are none."),
});
export type TriageResult = z.infer<typeof TriageResult>;

/**
 * JSON Schema for the Messages API `output_config.format`.
 *
 * `$schema` is dropped: it is not among the keywords structured outputs
 * supports, and an unrecognised root key risks a 400 for no benefit.
 */
const { $schema: _dropped, ...triageSchema } = z.toJSONSchema(TriageResult, {
  io: "output",
}) as Record<string, unknown>;

export const TRIAGE_JSON_SCHEMA = triageSchema;
