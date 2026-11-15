import { z } from "zod";
import { evidenceBundleSchema } from "../domain/evidenceBundle.js";
import { reconstructionSpecificationSchema } from "../domain/reconstructionVerificationSchemas.js";
import { verifyReconstruction } from "../domain/reconstructionVerification.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";
import { workflowInputError } from "./workflowInputError.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";

/** Portable counterpart of the session-owned MCP specification input. */
export const reconstructionVerificationRequestSchema = z.strictObject({
  specification: reconstructionSpecificationSchema,
  evidence_bundle: evidenceBundleSchema,
});

/** Evaluate the same finite specification offline against an explicit portable bundle. */
export const verifyReconstructionRequest = (
  input: z.output<typeof reconstructionVerificationRequestSchema>,
) => {
  try {
    return ok(
      jsonValueSchema.parse(
        verifyReconstruction(input.specification, input.evidence_bundle),
      ),
    );
  } catch (cause: unknown) {
    return err(
      cause instanceof TypeError || cause instanceof z.ZodError
        ? workflowInputError("verify_reconstruction", cause)
        : new AnalysisInputError("verify_reconstruction", { cause }),
    );
  }
};
