import { z } from "zod";
import type {
  WebCaptureComparisonRequest,
  WebScreenshotComparisonRequest,
} from "../contracts/webComparisonInputContracts.js";
import { createEvidence, type Evidence } from "../domain/evidence.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { compareBrowserCaptures } from "../domain/browserCaptureComparison.js";
import { comparePngScreenshots } from "../domain/pngVisualDiff.js";
import {
  WEB_COMPARISON_PROVIDER,
  readWebComparisonSource,
  webCaptureSourceInput,
  webScreenshotSourceArtifact,
  webScreenshotComparisonResultSchema,
  validateWebComparisonOriginMapping,
} from "../domain/webComparisonSources.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  resolvePairedEvidenceRequest,
  type EvidenceLookup,
} from "./EvidenceInputResolver.js";
import { workflowInputError } from "./workflowInputError.js";
import { commitBrowserScenarioNormalization } from "../domain/browserScenarioNormalization.js";

export interface WebComparisonContext {
  readonly lookup?: EvidenceLookup | undefined;
  readonly retain?:
    | ((records: readonly Evidence[]) => Result<unknown, AnalysisError>)
    | undefined;
}

/** Pure comparisons own their derivation semantics; CDP only produces observations. */
export const compareWebEvidence = (
  operation: "compare_web_captures" | "compare_web_screenshots",
  input: WebCaptureComparisonRequest | WebScreenshotComparisonRequest,
  context: WebComparisonContext = {},
): Result<Evidence, AnalysisError> => {
  try {
    let parameters;
    let result;
    let sources: Evidence[] = [];
    if ("left" in input) {
      const pair = resolvePairedEvidenceRequest(
        { left: input.left, right: input.right },
        context.lookup,
      );
      if (!pair.ok) return pair;
      const left = readWebComparisonSource(pair.value.left);
      const right = readWebComparisonSource(pair.value.right);
      validateWebComparisonOriginMapping(left, right, input.origin_mapping);
      sources = left.evidence_id === right.evidence_id ? [left] : [left, right];
      const identity = {
        left_evidence_id: left.evidence_id,
        right_evidence_id: right.evidence_id,
      };
      if ("normalization" in input) {
        const { normalization, origin_mapping } = input;
        parameters = {
          ...identity,
          normalization,
          ...(origin_mapping === undefined ? {} : { origin_mapping }),
        };
        result = compareBrowserCaptures(
          webCaptureSourceInput(left, right, { normalization, origin_mapping }),
        );
      } else {
        if (left.operation !== right.operation)
          throw new TypeError(
            "Screenshot comparison sources must have the same observation type.",
          );
        const { step_id, channel_threshold } = input;
        const before = webScreenshotSourceArtifact(left, step_id);
        const after = webScreenshotSourceArtifact(right, step_id);
        parameters = {
          ...identity,
          channel_threshold,
          ...(input.origin_mapping === undefined
            ? {}
            : { origin_mapping: input.origin_mapping }),
          ...(step_id === undefined ? {} : { step_id }),
          ...(before === undefined
            ? {}
            : { before_artifact_sha256: before.sha256 }),
          ...(after === undefined
            ? {}
            : { after_artifact_sha256: after.sha256 }),
        };
        result =
          before === undefined || after === undefined
            ? {
                status: "unavailable" as const,
                reason:
                  "The selected screenshot was not captured on both sources.",
                limitations: [
                  "Missing or truncated pixels do not establish visual equivalence.",
                ],
              }
            : comparePngScreenshots({ before, after, channel_threshold });
        result = webScreenshotComparisonResultSchema.parse(result);
      }
    } else {
      parameters = detachedParameters(input);
      result =
        "channel_threshold" in input
          ? comparePngScreenshots(input)
          : compareBrowserCaptures(input);
    }
    const evidence = createEvidence(undefined, WEB_COMPARISON_PROVIDER, {
      predicateType:
        operation === "compare_web_captures"
          ? "rea.web-capture-diff"
          : "rea.web-screenshot-diff",
      operation,
      parameters: z.record(z.string(), jsonValueSchema).parse(parameters),
      result: jsonValueSchema.parse(result),
      confidence: "derived",
      authority: "analyst-inference",
      environment: null,
      limitations: [
        ...result.limitations,
        ...(sources.length === 0
          ? [
              "Detached payload comparison has no authenticated source Evidence closure; it cannot verify reconstruction claims.",
            ]
          : []),
      ],
      evidenceLinks: sources.map((source) => source.evidence_id).sort(),
    });
    if (context.retain !== undefined) {
      const retained = context.retain([...sources, evidence]);
      if (!retained.ok) return retained;
    }
    return ok(evidence);
  } catch (cause: unknown) {
    if (
      !("left" in input) &&
      operation === "compare_web_screenshots" &&
      cause instanceof TypeError
    )
      return err(
        new AnalysisInputError(operation, { cause }, [
          { path: [], reason: "invalid_format", message: cause.message },
        ]),
      );
    return err(
      cause instanceof AnalysisError
        ? cause
        : cause instanceof TypeError || cause instanceof z.ZodError
          ? workflowInputError(operation, cause)
          : new AnalysisInputError(operation, { cause }),
    );
  }
};

const detachedParameters = (
  input: Exclude<
    WebCaptureComparisonRequest | WebScreenshotComparisonRequest,
    { left: unknown }
  >,
) => {
  if ("channel_threshold" in input)
    return {
      before_artifact_sha256: input.before.sha256,
      after_artifact_sha256: input.after.sha256,
      channel_threshold: input.channel_threshold,
    };
  if ("before_scenario" in input)
    return {
      comparison_kind: "browser_scenario",
      before_browser: input.before_scenario.browser,
      after_browser: input.after_scenario.browser,
      before_start_origin: input.before_scenario.scenario.start_origin,
      after_start_origin: input.after_scenario.scenario.start_origin,
      normalization_sha256: commitBrowserScenarioNormalization(
        input.normalization,
        input.origin_mapping,
      ).sha256,
    };
  return {
    before_target_id: input.before.inspection.target.target_id,
    after_target_id: input.after.inspection.target.target_id,
    before_capture_ended_at: input.before.inspection.capture_window.ended_at,
    after_capture_ended_at: input.after.inspection.capture_window.ended_at,
  };
};
