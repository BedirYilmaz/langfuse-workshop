/**
 * Run the hosted Langfuse dataset against the live agent.
 *
 * For each item in the dataset:
 *   1. Call the same runSupportConversation(...) the web app uses.
 *   2. Roll the per-item traces into one experiment run row.
 *   3. Attach callback evaluators from runExperiment:
 *      - keyword_overlap (deterministic)
 *      - correctness (LLM-as-a-judge)
 *
 * Usage:
 *   npm run dataset:run
 */
import "../src/server/load-env";

// --- 1. Boot the OpenTelemetry SDK so every observe(...) call inside
//        the agent emits spans to Langfuse, exactly like the live server.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { randomUUID } from "node:crypto";
import { LangfuseClient } from "@langfuse/client";
import OpenAI from "openai";
import type { ChatMessage } from "../src/shared/types";
import { env } from "../src/server/env";
import { runSupportConversation } from "../src/server/support-agent";

const langfuseSpanProcessor = new LangfuseSpanProcessor();
const sdk = new NodeSDK({ spanProcessors: [langfuseSpanProcessor] });
sdk.start();

// --- 2. Dataset item shape (must match data/seed-dataset.json).
type DatasetInput = {
  messages: Array<{
    role: ChatMessage["role"];
    content: string;
  }>;
};

type DatasetExpectation = {
  idealAnswer: string;
  expectedKeywords: string[];
};

// --- 3. The deterministic evaluator.
//        Fraction of expected keywords that show up (case-insensitive)
//        in the agent's answer. 1 means every expected keyword landed;
//        0 means none did.
function keywordOverlap(answer: string, expectedKeywords: string[]) {
  if (expectedKeywords.length === 0) {
    return 1;
  }

  const normalizedAnswer = answer.toLowerCase();
  const matches = expectedKeywords.filter((keyword) =>
    normalizedAnswer.includes(keyword.toLowerCase())
  );

  return matches.length / expectedKeywords.length;
}

// --- 4. The LLM-as-a-judge correctness evaluator.
//        Compares the agent answer to idealAnswer and returns 0 or 1.
//        Runs as a runExperiment callback so scores land with the run —
//        no Langfuse Platform evaluator setup required first.
async function scoreCorrectness(answer: string, idealAnswer: string) {
  const openai = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await openai.chat.completions.create({
    model: env.openaiModel,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You grade whether an assistant answer is correct relative to an ideal answer.",
          'Return JSON only: {"score": 0 or 1, "reasoning": "short explanation"}.',
          "Score 1 if the answer is substantively correct and covers the same meaning as the ideal answer (wording may differ).",
          "Score 0 if it is wrong, incomplete on a required point, or answers a different question."
        ].join(" ")
      },
      {
        role: "user",
        content: `Ideal answer:\n${idealAnswer}\n\nActual answer:\n${answer}`
      }
    ]
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: { score?: unknown; reasoning?: unknown } = {};
  try {
    parsed = JSON.parse(raw) as { score?: unknown; reasoning?: unknown };
  } catch {
    parsed = {};
  }

  const score = Number(parsed.score) === 1 ? 1 : 0;
  const reasoning =
    typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
      ? parsed.reasoning.trim()
      : score === 1
        ? "Marked correct by the judge."
        : "Marked incorrect by the judge.";

  return { score, reasoning };
}

// Convert a dataset item's messages array into the ChatMessage shape
// the live server uses (adds id + timestamp on each message).
function toRuntimeMessages(input: DatasetInput) {
  return input.messages.map((message, index) => ({
    id: `dataset-message-${index + 1}`,
    role: message.role,
    content: message.content,
    timestamp: new Date().toISOString()
  }));
}

async function main() {
  if (!env.langfusePublicKey || !env.langfuseSecretKey) {
    throw new Error("Langfuse credentials are required to run dataset experiments.");
  }

  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required to run the agent and the correctness judge.");
  }

  // --- 5. Pull the hosted dataset by DATASET_NAME from .env.
  const langfuse = new LangfuseClient({
    publicKey: env.langfusePublicKey,
    secretKey: env.langfuseSecretKey,
    baseUrl: env.langfuseBaseUrl
  });

  const dataset = await langfuse.dataset.get(env.datasetName);
  const runName = `dad-it-support-${new Date().toISOString()}`;

  // --- 6. runExperiment iterates the dataset, calls `task` for each
  //        item, and records every per-item trace + score under a
  //        single run row identified by `runName`.
  const result = await dataset.runExperiment({
    name: "Dad IT Support Agent experiment",
    runName,
    description: "Workshop dataset run for the Dad IT Support Agent",
    metadata: {
      model: env.openaiModel
    },
    maxConcurrency: 1,
    // `task` runs the agent on one dataset item. The return value
    // becomes the experiment item's `output` and is what the
    // evaluators below score.
    task: async (item) => {
      const input = item.input as DatasetInput;
      const response = await runSupportConversation({
        sessionId: `dataset-${randomUUID()}`,
        userId: "dataset-runner",
        messages: toRuntimeMessages(input)
      });

      return response.answer;
    },
    // Callback evaluators run in this process after `task` returns.
    // Each one returns a Langfuse score attached to the item's trace.
    evaluators: [
      async ({ output, expectedOutput }) => {
        const expected = expectedOutput as DatasetExpectation;
        const overlap = keywordOverlap(output as string, expected.expectedKeywords);

        return {
          name: "keyword_overlap",
          value: overlap,
          comment: `Matched ${Math.round(
            overlap * expected.expectedKeywords.length
          )} of ${expected.expectedKeywords.length} expected keywords.`
        };
      },
      async ({ output, expectedOutput }) => {
        const expected = expectedOutput as DatasetExpectation;
        const { score, reasoning } = await scoreCorrectness(
          output as string,
          expected.idealAnswer
        );

        return {
          name: "correctness",
          value: score,
          comment: reasoning
        };
      }
    ]
  });

  // --- 7. Pretty-print the summary table and flush any pending spans
  //        before the process exits.
  console.log(await result.format());
  await langfuse.flush();
  await langfuseSpanProcessor.forceFlush();
  await sdk.shutdown();
}

void main();
