import type { ProviderIdentity } from "./AnalysisProvider.js";
import {
  createEvidence,
  type Evidence,
  type EvidenceObservation,
} from "../domain/evidence.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import type {
  InspectWebPageInput,
  ListBrowserTargetsInput,
} from "../domain/browserObservation.js";
import type {
  BrowserTargetList,
  WebPageInspection,
} from "../domain/browserObservationSchemas.js";
import type {
  AnalyzeWebBundleInput,
  WebBundleAnalysis,
} from "../domain/webBundleAnalysis.js";
import type {
  ObserveWebSessionInput,
  WebObservationSession,
} from "../domain/browserSession.js";
import type {
  DiscoverWebMcpToolsInput,
  WebMcpDiscovery,
} from "../domain/webMcpDiscovery.js";
import type {
  CaptureWebScreenshotInput,
  WebScreenshot,
} from "../domain/webScreenshot.js";

type BrowserEvidenceInput =
  | ListBrowserTargetsInput
  | InspectWebPageInput
  | AnalyzeWebBundleInput
  | ObserveWebSessionInput
  | DiscoverWebMcpToolsInput
  | CaptureWebScreenshotInput;
type BrowserEvidenceResult =
  | BrowserTargetList
  | WebPageInspection
  | WebBundleAnalysis
  | WebObservationSession
  | WebMcpDiscovery
  | WebScreenshot;
type BrowserEvidenceOperation =
  | "list_browser_targets"
  | "inspect_web_page"
  | "analyze_web_bundle"
  | "observe_web_session"
  | "discover_webmcp_tools"
  | "capture_web_screenshot";

/** Create Evidence for one request-scoped external browser observation. */
export const createBrowserEvidence = (
  operation: BrowserEvidenceOperation,
  input: BrowserEvidenceInput,
  result: BrowserEvidenceResult,
  provider: ProviderIdentity,
): Evidence =>
  createEvidence(undefined, provider, {
    predicateType: browserPredicate(operation),
    operation,
    parameters: browserParameters(input, result),
    result: jsonValueSchema.parse(result),
    confidence: "observed",
    authority: "external-service",
    environment:
      "browser" in result
        ? {
            id: `${result.browser.product}@${result.browser.revision}`,
            platform: "unknown",
            architecture: "unknown",
            isolation: "none",
          }
        : null,
    limitations: [
      ...result.limitations,
      ...("browser" in result
        ? ["Browser host platform and architecture were not observed."]
        : []),
    ],
  });

const browserParameters = (
  input: BrowserEvidenceInput,
  result: BrowserEvidenceResult,
): EvidenceObservation["parameters"] => {
  const observedOrigin = browserResultTargetOrigin(result);
  const scope = {
    cdp_endpoint: input.cdp_endpoint,
    allowed_origins:
      input.allowed_origins.length > 0
        ? input.allowed_origins
        : "target_id" in input && observedOrigin !== undefined
          ? [observedOrigin]
          : [],
  };
  if (!("target_id" in input)) return scope;
  return {
    ...scope,
    target_id: input.target_id,
    ...("observation_ms" in input
      ? { observation_ms: input.observation_ms }
      : {}),
    ...("include_accessibility_text" in input
      ? {
          include_accessibility_text: input.include_accessibility_text,
          include_console_text: input.include_console_text,
          include_json_body_shapes: input.include_json_body_shapes,
          include_websocket_shapes: input.include_websocket_shapes,
          include_storage_keys: input.include_storage_keys,
          include_storage_fingerprints: input.include_storage_fingerprints,
          ...("include_script_sources" in input
            ? { include_script_sources: input.include_script_sources }
            : {}),
        }
      : {}),
    ...("fetch_source_maps" in input
      ? { fetch_source_maps: input.fetch_source_maps }
      : {}),
  };
};

const browserResultTargetOrigin = (
  result: BrowserEvidenceResult,
): string | undefined => {
  if (!("target" in result)) return undefined;
  if ("origin" in result.target) return result.target.origin;
  if ("initial_url" in result.target)
    return sanitizeBrowserUrl(result.target.initial_url).origin ?? undefined;
  return undefined;
};

const browserPredicate = (operation: BrowserEvidenceOperation): string => {
  switch (operation) {
    case "list_browser_targets":
      return "rea.browser-target-list";
    case "inspect_web_page":
      return "rea.web-page-inspection";
    case "analyze_web_bundle":
      return "rea.web-bundle-analysis";
    case "observe_web_session":
      return "rea.web-observation-session";
    case "discover_webmcp_tools":
      return "rea.webmcp-discovery";
    case "capture_web_screenshot":
      return "rea.web-screenshot";
  }
};
