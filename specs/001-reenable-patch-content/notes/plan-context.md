# Plan Context (deferred from `/speckit-specify`)

The user pasted the following technical context in the same
`/speckit-specify` invocation. It is implementation-level (HOW), so it does
not belong in `spec.md` — it is preserved here verbatim for the next step
(`/speckit-plan`) to consume.

> The implementation lives in TypeScript with the existing tsup build,
> axios HTTP client, and zod input schema validation. Match the style of
> the other tool handlers in src/. Add tests using a mock HTTP server
> (nock, msw, or undici's MockAgent) since the repo has no existing test
> infrastructure.

## Anchors discovered while writing the spec (not authoritative — verify in plan)

- Previous tool declaration: [src/tools/write-tools.ts:52](../../../src/tools/write-tools.ts#L52)
  (commented out, kept as reference)
- Previous handler case: [src/index.ts:333](../../../src/index.ts#L333)
  (commented out)
- Service-layer method `patchContent` is still present and uncommented:
  [src/services/obsidian-rest.ts:150](../../../src/services/obsidian-rest.ts#L150)
- Sibling tools whose style should be matched: `append_content`,
  `put_content` in [src/tools/write-tools.ts](../../../src/tools/write-tools.ts)
- Upstream issue cited as the original reason for disablement:
  https://github.com/coddingtonbear/obsidian-local-rest-api/issues/146
