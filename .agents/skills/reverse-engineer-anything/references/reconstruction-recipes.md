# Complete investigation and reconstruction recipes

Use this route when the requested outcome includes an independent implementation
of one feature, rather than only an explanation or a comparison.

When already advertised by the connected server, the native MCP prompts are:

- `reconstruct_web_feature`: required `feature` and `original_url`; optional
  `candidate_url`, `browser_executable_path`, `output_directory`, `constraints`
  and `original_evidence_id`.
- `reconstruct_cli_feature`: required `feature` and `target_path`; optional
  `candidate_path`, `arguments_json`, `working_directory`, `output_directory`,
  `constraints` and `original_evidence_id`.

Prompt retrieval supplies optional guidance, not a tool call, execution grant or
mandatory plan. Do not rediscover prompts, run setup or call irrelevant tools just
to follow a recipe. Older servers may not expose these prompts; the same work can
be composed with existing available tools and ordinary agent coding.

The complete [web and CLI recipes](https://github.com/morluto/rea/blob/main/docs/investigation-reconstruction-recipes.md)
and their linked runnable examples cover question/scope, original observations,
a source-cited reconstruction brief, independent construction, comparative
failure, correction and finite verification. Their builders are source-owned
deterministic examples, not proof of an AI agent's reconstruction quality.

Keep three distinctions throughout:

1. The brief is analyst-authored. Link observed requirements to Evidence and label
   inferred implementation choices and unknowns separately. Preserve original
   target and invocation identity, including interpreter versus script.
2. The agent's ordinary coding tools build the candidate. REA supplies inspection
   and verification; a candidate must not delegate its answers to the original.
3. Verify only declared comparable claims. Visual agreement is not behavior;
   reported output is not an unobserved persistence effect. Incomplete captures,
   incompatible experiments and absent authority remain unknown.

For new CLI captures, respect the existing supported Linux/macOS PTY boundary;
native Windows capture is unavailable. Do not turn a stand-in or an unavailable
host into an observed runtime result. Recorded complete captures can still be
compared offline. Preserve the failing and corrected Evidence and export before
closing a session when later work needs its records.
