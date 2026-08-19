import "server-only";

import { aiProposalTextDraftSchema, type AiProposalTextDraft } from "../validation/ai-proposal-text";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
/** A small, inexpensive general-purpose model -- overridable per-environment via OPENROUTER_MODEL, see .env.example. Never hardcode an expensive model as the only option. */
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 2000;

export type OpenRouterErrorCode = "missing_api_key" | "invalid_json" | "request_failed" | "timeout";

export type OpenRouterResult =
  | { ok: true; draft: AiProposalTextDraft; model: string; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; errorCode: OpenRouterErrorCode; message: string; model: string };

type ChatCompletionResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  return typeof value === "object" && value !== null;
}

function extractContent(body: unknown): string | null {
  if (!isChatCompletionResponse(body)) return null;
  const content = body.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim().length > 0 ? content : null;
}

function extractTokenCounts(body: unknown): { inputTokens: number | null; outputTokens: number | null } {
  if (!isChatCompletionResponse(body)) return { inputTokens: null, outputTokens: null };
  const usage = body.usage;
  return {
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
  };
}

/** A model's response is sometimes wrapped in ```json fences despite response_format: json_object -- strip them before parsing rather than failing outright. */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function parseDraftJson(content: string): AiProposalTextDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(content));
  } catch {
    return null;
  }
  const result = aiProposalTextDraftSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

async function callOpenRouter(apiKey: string, model: string, siteUrl: string, appName: string, system: string, user: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(siteUrl ? { "HTTP-Referer": siteUrl } : {}),
        "X-Title": appName,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls OpenRouter server-side ONLY -- never import this module from a
 * Client Component. Reads OPENROUTER_API_KEY (never NEXT_PUBLIC_) at call
 * time, not at module load, so a missing key never crashes an unrelated
 * page that happens to import something from this file's package.
 *
 * Returns a discriminated result, never throws for an expected failure
 * (missing key, timeout, malformed response) -- callers turn `ok: false`
 * into a friendly message and a sanitized `errorCode` for
 * record_ai_generation_event(), never the raw provider error text (which
 * could be large, could echo back parts of the prompt, or could contain
 * provider-internal details).
 */
export async function generateProposalTextDraft(system: string, user: string): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    return { ok: false, errorCode: "missing_api_key", message: "AI writing is not configured yet.", model };
  }

  const siteUrl = process.env.OPENROUTER_SITE_URL || process.env.APP_BASE_URL || "";
  const appName = process.env.OPENROUTER_APP_NAME || "Scopevia";

  let response: Response;
  try {
    response = await callOpenRouter(apiKey, model, siteUrl, appName, system, user);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, errorCode: "timeout", message: "AI writing timed out. Please try again.", model };
    }
    return { ok: false, errorCode: "request_failed", message: "We couldn't reach the AI writing service. Please try again.", model };
  }

  if (!response.ok) {
    // Never surface the raw provider response body -- it can contain
    // internal error details, could be arbitrarily large, and (per
    // docs/79-openrouter-security.md) must never reach the client as-is.
    return { ok: false, errorCode: "request_failed", message: "AI writing is temporarily unavailable. Please try again.", model };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, errorCode: "invalid_json", message: "AI writing returned an unexpected response. Please try again.", model };
  }

  const content = extractContent(body);
  const draft = content ? parseDraftJson(content) : null;
  if (draft) {
    const { inputTokens, outputTokens } = extractTokenCounts(body);
    return { ok: true, draft, model, inputTokens, outputTokens };
  }

  // One retry, with a sharper reminder appended -- covers the common case
  // of a model momentarily wrapping JSON in prose despite instructions.
  let retryResponse: Response;
  try {
    retryResponse = await callOpenRouter(
      apiKey,
      model,
      siteUrl,
      appName,
      `${system}\n\nIMPORTANT: your previous response was not valid JSON matching the required shape. Respond with ONLY the JSON object, nothing else.`,
      user
    );
  } catch {
    return { ok: false, errorCode: "invalid_json", message: "AI writing returned an unexpected response. Please try again.", model };
  }

  if (!retryResponse.ok) {
    return { ok: false, errorCode: "invalid_json", message: "AI writing returned an unexpected response. Please try again.", model };
  }

  let retryBody: unknown;
  try {
    retryBody = await retryResponse.json();
  } catch {
    return { ok: false, errorCode: "invalid_json", message: "AI writing returned an unexpected response. Please try again.", model };
  }

  const retryContent = extractContent(retryBody);
  const retryDraft = retryContent ? parseDraftJson(retryContent) : null;
  if (!retryDraft) {
    return { ok: false, errorCode: "invalid_json", message: "AI writing returned an unexpected response. Please try again.", model };
  }

  const { inputTokens, outputTokens } = extractTokenCounts(retryBody);
  return { ok: true, draft: retryDraft, model, inputTokens, outputTokens };
}
