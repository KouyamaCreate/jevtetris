import { createGateway } from "@ai-sdk/gateway";
import {
  experimental_evaluate as evaluate,
  type Experimental_EvaluationQuestion,
} from "ai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { OpenRouter } from "@openrouter/sdk";
import type { DecisionsRequest, DecisionsResponse, Questions } from "@openrouter/sdk/models";

export type JevProvider = "typesafe" | "vercel" | "openrouter" | "cloudflare";
export type JevProviderSelection = JevProvider | "auto";

export type JevAnswer =
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "boolean"; probability: number }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; probabilities?: Record<string, number>; confidence?: number };

export type JevEvaluationResult = {
  answers: Record<string, JevAnswer>;
  response: { modelId: string };
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  };
  provider: JevProvider;
};

export type JevEvaluationRequest = {
  state: EvaluationState;
  questions: Record<string, Experimental_EvaluationQuestion>;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  gatewayTags?: string[];
};

type EvaluationState = Parameters<typeof evaluate>[0]["state"];

export type JevProviderStatus = {
  selection: JevProviderSelection;
  provider: JevProvider | null;
  configured: boolean;
  available: JevProvider[];
  missing: string[];
  error?: string;
};

const DEFAULT_TYPESAFE_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_OPENROUTER_MODEL = "typesafe/jev-1.13";
const DEFAULT_CLOUDFLARE_MODEL = "typesafe/jev";

/**
 * The provider is resolved on the server for every request. Keys never leave
 * this module and are intentionally not included in status responses.
 */
export function getJevProviderStatus(): JevProviderStatus {
  const selection = readSelection();
  const available = getAvailableProviders();

  if (selection !== "auto") {
    const missing = missingRequirements(selection);
    return {
      selection,
      provider: missing.length === 0 ? selection : null,
      configured: missing.length === 0,
      available,
      missing,
      ...(selection === "cloudflare" && !process.env.CLOUDFLARE_ACCOUNT_ID
        ? { error: "CloudflareはAPIトークンとアカウントIDが必要です。" }
        : {}),
    };
  }

  const provider = available[0] ?? null;
  return {
    selection,
    provider,
    configured: provider !== null,
    available,
    missing: provider === null ? ["JEV_PROVIDER または対応するAPIキー"] : [],
  };
}

export function evaluateJev({
  state,
  questions,
  maxRetries = 0,
  abortSignal,
  gatewayTags,
}: JevEvaluationRequest): Promise<JevEvaluationResult> {
  const status = getJevProviderStatus();
  if (!status.configured || !status.provider) {
    throw new JevProviderError(
      status.error ?? "Jevプロバイダが設定されていません。",
      503,
      "JEV_PROVIDER_NOT_CONFIGURED",
      status.provider ?? undefined,
    );
  }

  switch (status.provider) {
    case "typesafe":
      return evaluateWithAiSdk({
        provider: "typesafe",
        model: createTypeSafeAi({
          apiKey: firstEnv("TYPESAFE_AI_API_KEY", "TYPESAFE_API_KEY"),
          baseURL: process.env.TYPESAFE_AI_BASE_URL?.trim() || DEFAULT_TYPESAFE_BASE_URL,
        }).evaluationModel("jev-latest"),
        state,
        questions,
        maxRetries,
        abortSignal,
      });
    case "vercel":
      return evaluateWithAiSdk({
        provider: "vercel",
        model: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY?.trim() || undefined }).evaluationModel(
          "typesafe-ai/jev-latest",
        ),
        state,
        questions,
        maxRetries,
        abortSignal,
        gatewayTags,
      });
    case "openrouter":
      return evaluateWithOpenRouter({ state, questions, abortSignal });
    case "cloudflare":
      return evaluateWithCloudflare({ state, questions, abortSignal });
  }
}

export class JevProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly provider?: JevProvider,
  ) {
    super(message);
    this.name = "JevProviderError";
  }
}

function evaluateWithAiSdk({
  provider,
  model,
  state,
  questions,
  maxRetries,
  abortSignal,
  gatewayTags,
}: {
  provider: "typesafe" | "vercel";
  model: Parameters<typeof evaluate>[0]["model"];
  state: EvaluationState;
  questions: Record<string, Experimental_EvaluationQuestion>;
  maxRetries: number;
  abortSignal?: AbortSignal;
  gatewayTags?: string[];
}): Promise<JevEvaluationResult> {
  return evaluate({
    model,
    state,
    questions,
    maxRetries,
    abortSignal,
    ...(provider === "vercel" && gatewayTags?.length
      ? { providerOptions: { gateway: { tags: gatewayTags } } }
      : {}),
  }).then((result) => ({
    answers: result.answers as Record<string, JevAnswer>,
    response: { modelId: result.response.modelId },
    usage: result.usage,
    provider,
  }));
}

async function evaluateWithOpenRouter({
  state,
  questions,
  abortSignal,
}: Pick<JevEvaluationRequest, "state" | "questions" | "abortSignal">): Promise<JevEvaluationResult> {
  const model = process.env.OPENROUTER_JEV_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  const client = new OpenRouter({ apiKey: firstEnv("OPENROUTER_API_KEY") });
  const request: DecisionsRequest = {
    model,
    state: state as DecisionsRequest["state"],
    questions: toNativeQuestions(questions),
  };

  try {
    const result = await client.alpha.decisions.create(
      { decisionsRequest: request },
      { fetchOptions: { signal: abortSignal } },
    );
    return normalizeNativeResult(result, "openrouter", model);
  } catch (error) {
    throw toProviderError(error, "openrouter");
  }
}

async function evaluateWithCloudflare({
  state,
  questions,
  abortSignal,
}: Pick<JevEvaluationRequest, "state" | "questions" | "abortSignal">): Promise<JevEvaluationResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = firstEnv("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY");
  const model = process.env.CLOUDFLARE_JEV_MODEL?.trim() || DEFAULT_CLOUDFLARE_MODEL;
  if (!accountId || !token) {
    throw new JevProviderError("CloudflareのAPIトークンとアカウントIDが必要です。", 503, "CLOUDFLARE_NOT_CONFIGURED", "cloudflare");
  }

  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
  if (gatewayId) headers.set("cf-aig-gateway-id", gatewayId);

  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: {
          state,
          questions: toNativeQuestions(questions),
        },
      }),
      signal: abortSignal,
    });
  } catch (error) {
    throw toProviderError(error, "cloudflare");
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new JevProviderError(getRemoteErrorMessage(payload), response.status, "CLOUDFLARE_REQUEST_FAILED", "cloudflare");
  }

  const result = isRecord(payload) && isRecord(payload.result) ? payload.result : payload;
  if (!isNativeResult(result)) {
    throw new JevProviderError("CloudflareからJevの回答形式が返りませんでした。", 502, "INVALID_PROVIDER_RESPONSE", "cloudflare");
  }
  return normalizeNativeResult(result, "cloudflare", model);
}

function toNativeQuestions(questions: Record<string, Experimental_EvaluationQuestion>): Record<string, Questions> {
  return Object.fromEntries(
    Object.entries(questions).map(([key, question]) => {
      if (question.type !== "boolean") return [key, question as Questions];
      return [
        key,
        {
          type: "noul",
          instructions: question.instructions,
          criteria: {
            true: question.criteria?.true ?? "true",
            false: question.criteria?.false ?? "false",
          },
        },
      ];
    }),
  ) as Record<string, Questions>;
}

function normalizeNativeResult(result: DecisionsResponse, provider: JevProvider, fallbackModel: string): JevEvaluationResult {
  return {
    answers: result.answers as Record<string, JevAnswer>,
    response: { modelId: result.model || fallbackModel },
    usage: {
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens:
        typeof result.usage?.inputTokens === "number" && typeof result.usage?.outputTokens === "number"
          ? result.usage.inputTokens + result.usage.outputTokens
          : undefined,
    },
    provider,
  };
}

function isNativeResult(value: unknown): value is DecisionsResponse {
  return isRecord(value) && isRecord(value.answers) && isRecord(value.usage) && typeof value.model === "string";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getRemoteErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) return "Jevプロバイダへのリクエストに失敗しました。";
  const error = payload.error;
  if (typeof error === "string") return error.slice(0, 240);
  if (isRecord(error) && typeof error.message === "string") return error.message.slice(0, 240);
  if (Array.isArray(payload.errors)) {
    const first = payload.errors[0];
    if (isRecord(first) && typeof first.message === "string") return first.message.slice(0, 240);
  }
  return "Jevプロバイダへのリクエストに失敗しました。";
}

function toProviderError(error: unknown, provider: JevProvider): JevProviderError {
  if (error instanceof JevProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new JevProviderError("Jevプロバイダへのリクエストが中断されました。", 504, "REQUEST_ABORTED", provider);
  }
  const candidate = error as { status?: unknown; message?: unknown };
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  const message = typeof candidate?.message === "string" ? candidate.message.slice(0, 240) : "Jevプロバイダへのリクエストに失敗しました。";
  return new JevProviderError(message, status, "PROVIDER_REQUEST_FAILED", provider);
}

function readSelection(): JevProviderSelection {
  const value = process.env.JEV_PROVIDER?.trim().toLowerCase();
  if (!value || value === "auto") return "auto";
  if (value === "typesafe" || value === "vercel" || value === "openrouter" || value === "cloudflare") return value;
  return "auto";
}

function getAvailableProviders(): JevProvider[] {
  return (["typesafe", "vercel", "openrouter", "cloudflare"] as JevProvider[]).filter(
    (provider) => missingRequirements(provider).length === 0,
  );
}

function missingRequirements(provider: JevProvider): string[] {
  switch (provider) {
    case "typesafe":
      return firstEnv("TYPESAFE_AI_API_KEY", "TYPESAFE_API_KEY") ? [] : ["TYPESAFE_AI_API_KEY"];
    case "vercel":
      return firstEnv("AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN") ? [] : ["AI_GATEWAY_API_KEY または VERCEL_OIDC_TOKEN"];
    case "openrouter":
      return firstEnv("OPENROUTER_API_KEY") ? [] : ["OPENROUTER_API_KEY"];
    case "cloudflare":
      return [
        !firstEnv("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY") ? "CLOUDFLARE_API_TOKEN" : null,
        !process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ? "CLOUDFLARE_ACCOUNT_ID" : null,
      ].filter((value): value is string => value !== null);
  }
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
