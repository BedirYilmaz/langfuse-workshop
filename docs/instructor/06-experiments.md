---
title: "Workshop: Instructor Notes for Experiments"
description: "Facilitator notes for running Langfuse experiments, combining an in-script deterministic score with an LLM-as-a-judge evaluator, and inspecting run results."
---

# 06 Experiments

Learner guide: [06 Experiments](../learner/06-experiments.md)

## Instructor notes

- The key idea is reuse: the experiment runner calls the same `runSupportConversation(...)` as the web app.
- Contrast deterministic scoring in the script (`keyword_overlap`) with LLM-as-a-judge scoring (`correctness`).
- Confirm the default evaluator model before the **Check Correctness** setup. If learners did not configure it in session 4, send them to **Project Settings → LLM Connections** first.
- In the evaluator's sample panel, choose **Experiments** so the filter becomes `isExperimentItemRootSpan: true`. Correctness needs experiment context because that is where expected output is available.
- The current template mapping has two variables: `output` maps to the experiment item's **Output**, and `expected_output` maps to **Expected Output → idealAnswer**.
- Emphasize the mixed setup: the script owns the cheap deterministic check, while Langfuse owns the semantic judge.
- Keep concurrency at one for workshops so traces and the final run summary are easy to follow.
- Before running the dataset, confirm both the OpenAI and Langfuse credentials point to active projects. The runner can finish with exit code 0 after skipping every item, so always check that the console prints experiment results rather than only SDK errors.

## Demo rhythm

1. Skim the numbered sections in `scripts/run-dataset.ts`.
2. Point out the `keyword_overlap` evaluator inside the script.
3. Create **Check Correctness**, filter the sample panel to **Experiments**, and map `output` plus `expected_output`.
4. Run `npm run dataset:run`.
5. Open the run table, per-item traces, and chart view.

## Watch for

- Keep **Check Correctness** filtered to **Experiments**. A live-observation target does not provide the dataset ground truth required by this evaluator.
- If no experiment run exists yet, the right-side sample table may show zero matches. That is expected before `npm run dataset:run` creates a baseline run.
- Map `output` to **Output** with no path, and map `expected_output` to **Expected Output → idealAnswer**. Do not map the whole expected-output object.
- Do not use `expectedKeywords` as the correctness reference. That field belongs to the in-script `keyword_overlap` evaluator.
- Learners assuming the deterministic check must live in Langfuse now. It does not; mention the code-evaluator docs only as an alternative.
- "No default model set" means Langfuse needs an LLM connection/default evaluator model; it is not fixed by editing `.env`.
- `401 The project you are requesting has been archived` followed by `No experiment results to display` means the OpenAI key belongs to an archived project. Replace `OPENAI_API_KEY` locally with a key from an active project, then rerun.
- Slow asynchronous evaluator results; the console only shows the final summary, so refresh Langfuse after the run finishes if `correctness` is still pending.
