import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, it } from "vitest";

import { createBrowserScenarioEvidence } from "../../../src/application/BrowserScenarioEvidence.js";
import { browserScenarioSchema } from "../../../src/domain/browserScenario.js";
import { browserScenarioCaptureSchema } from "../../../src/domain/browserScenarioCapture.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { createWebScreenshotArtifact } from "../../../src/domain/webScreenshot.js";
import { runCliJson } from "../../fixtures/cliJsonProcess.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const originalOrigin = "https://original.example.test";
const candidateOrigin = "http://127.0.0.1:43817";
const mapping = {
  before_origin: originalOrigin,
  after_origin: candidateOrigin,
};
const complete = {
  status: "complete",
  equality_eligible: true,
  missing_sections: [],
  truncated_sections: [],
};

// These source-owned records model the producer boundary. This acceptance case
// exercises the compiled CLI and stdio MCP, not a live browser. The runnable
// example in scripts/examples/web-reconstruction.mjs captures its own real page.
const recordedScenario = (origin: string, count: number): Evidence => {
  const request = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: process.execPath },
    start_url: { url: `${origin}/` },
    environment: { viewport: { width: 1, height: 1, device_scale_factor: 1 } },
    actions: [
      {
        step_id: "save",
        action: "click",
        locator: { kind: "role", role: "button", name: "Save" },
      },
    ],
    capture: {
      after_each_step: ["screenshot", "dom", "url"],
      at_end: ["screenshot", "dom", "url"],
      events: ["console"],
    },
  });
  const url = {
    url: `${origin}/`,
    origin,
    query_parameter_names: [],
    redacted: false,
  };
  const text = "<main><button>Save</button><p>Saved</p></main>";
  const dom = {
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
    text,
  };
  const screenshot = {
    state: "captured",
    value: createWebScreenshotArtifact(pixelPng()),
  };
  const artifacts = {
    screenshot,
    dom: { state: "captured", value: dom },
    url: { state: "captured", value: url },
    accessibility: { state: "not_requested" },
    history: { state: "not_requested" },
    storage: { state: "not_requested" },
  };
  const step = (index: number) => ({
    step_index: index,
    step_id: index === 0 ? "scenario_start" : "save",
    action: index === 0 ? "goto_start" : "click",
    status: "completed",
    error: null,
    elapsed_ms: index,
    before_url:
      index === 0
        ? {
            url: "about:blank",
            origin: null,
            query_parameter_names: [],
            redacted: false,
          }
        : url,
    after_url: url,
    event_sequence_start: 1,
    event_sequence_end: index,
    artifacts,
    completeness: complete,
  });
  const capture = browserScenarioCaptureSchema.parse({
    browser: {
      mode: "launch",
      process_ownership: "provider-owned",
      cleanup: "terminated-owned-process",
      product: "Chromium fixture",
      version: "1",
    },
    scenario: {
      start_origin: origin,
      action_count: 1,
      secret_references: [],
      network_content: request.capture.network,
      event_families: ["console"],
    },
    duration_ms: 1,
    steps: [step(0), step(1)],
    events: {
      retained: 1,
      dropped: 0,
      items: [
        {
          kind: "console",
          level: "info",
          text: `saved-count=${count}`,
          url: null,
          sequence: 1,
          step_index: 1,
        },
      ],
    },
    completeness: complete,
    limitations: [],
  });
  return createBrowserScenarioEvidence(request, capture, {
    id: "rea-playwright-browser",
    name: "REA Playwright browser",
    version: "1",
  });
};

const pixelPng = (): Buffer => {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 20, 40, 60, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const specification = (capture: Evidence, pixels: Evidence) => ({
  name: "Save: appearance, reported behavior and unobserved storage",
  claims: [
    {
      claim_id: "save-appearance",
      title: "The saved screen has identical pixels",
      kind: "web-screenshot",
      comparison_evidence_id: pixels.evidence_id,
      dimension: "pixels",
      maximum_changed_ratio: 0,
    },
    {
      claim_id: "save-count",
      title: "Save reports the same counter",
      kind: "web-scenario",
      comparison_evidence_id: capture.evidence_id,
      dimension: "events",
      step_id: "save",
    },
    {
      claim_id: "save-storage",
      title: "Save preserves storage",
      kind: "web-scenario",
      comparison_evidence_id: capture.evidence_id,
      dimension: "storage",
      step_id: "save",
    },
  ],
});

const expectedClaims = [
  { claim_id: "save-appearance", status: "pass" },
  { claim_id: "save-count", status: "fail" },
  { claim_id: "save-storage", status: "unknown" },
];

it("verifies Evidence-bound web claims through CLI files and retained stdio MCP without treating matching pixels as matching behavior", async () => {
  const root = await createTestTempDirectory("rea-web-reconstruction-");
  const left = recordedScenario(originalOrigin, 1);
  const right = recordedScenario(candidateOrigin, 2);
  const leftPath = join(root, "original.json");
  const rightPath = join(root, "candidate.json");
  await writeFile(leftPath, JSON.stringify(left));
  await writeFile(rightPath, JSON.stringify(right));

  const capture = parseEvidence(
    await runCliJson([
      "compare-web-captures",
      leftPath,
      rightPath,
      "--origin-mapping-json",
      JSON.stringify(mapping),
      "--json",
    ]),
  );
  const pixels = parseEvidence(
    await runCliJson([
      "compare-web-screenshots",
      leftPath,
      rightPath,
      "--step-id",
      "save",
      "--origin-mapping-json",
      JSON.stringify(mapping),
      "--json",
    ]),
  );
  expect(capture).toMatchObject({
    confidence: "derived",
    authority: "analyst-inference",
    evidence_links: [left.evidence_id, right.evidence_id].sort(),
  });
  expect(pixels.normalized_result).toMatchObject({
    status: "identical",
    changed_ratio: 0,
  });
  const requestPath = join(root, "verification.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      specification: specification(capture, pixels),
      evidence_bundle: createEvidenceBundle([left, right, capture, pixels]),
    }),
  );
  expect(
    await runCliJson(["verify-reconstruction", requestPath, "--json"]),
  ).toMatchObject({ status: "fail", claims: { items: expectedClaims } });

  const mcp = await connectLocalToolsMcp();
  const compared = await mcp.call("compare_web_captures", {
    left,
    right,
    origin_mapping: mapping,
  });
  expect(compared.isError).not.toBe(true);
  const mcpCapture = parseEvidence(compared.structuredContent);
  const reference = (evidence: Evidence) => ({
    kind: "retained-evidence",
    evidence_id: evidence.evidence_id,
  });
  const visual = await mcp.call("compare_web_screenshots", {
    left: reference(left),
    right: reference(right),
    step_id: "save",
    origin_mapping: mapping,
  });
  expect(visual.isError).not.toBe(true);
  const mcpPixels = parseEvidence(visual.structuredContent);
  expect(mcpCapture.evidence_id).toBe(capture.evidence_id);
  expect(mcpPixels.evidence_id).toBe(pixels.evidence_id);
  const verified = await mcp.call("verify_reconstruction", {
    specification: specification(mcpCapture, mcpPixels),
  });
  expect(verified.isError).not.toBe(true);
  expect(
    parseEvidence(verified.structuredContent).normalized_result,
  ).toMatchObject({ status: "fail", claims: { items: expectedClaims } });

  const otherSession = await connectLocalToolsMcp();
  expect(
    (
      await otherSession.call("compare_web_screenshots", {
        left: reference(left),
        right: reference(right),
        step_id: "save",
      })
    ).isError,
  ).toBe(true);
  const tampered = {
    ...left,
    parameters: { ...left.parameters, scenario_sha256: "0".repeat(64) },
  };
  expect(
    (
      await mcp.call("compare_web_captures", {
        left: tampered,
        right,
        origin_mapping: mapping,
      })
    ).isError,
  ).toBe(true);
}, 60_000);
