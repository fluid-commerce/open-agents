# [Template Name]

**Published:** [Date] | **Authors:** [Authors] | **Category:** Templates

*An open-source template for building background agents on Vercel.*

---

Most AI-assisted workflows today are synchronous. You prompt, you wait, you review, you prompt again. If you close your laptop, the work stops.

Background agents work differently. You assign a task, the agent spins up an isolated cloud environment, and it works independently until the task is done. You can run multiple agents in parallel. You can close your laptop. The agent commits its work, opens a pull request, and you review the output like you'd review a colleague's.

This is a hard infrastructure problem. The agent needs isolated compute that persists across interruptions. The workflow needs to survive restarts and scale beyond any single request timeout. The agent needs access to models from multiple providers with automatic failover so your platform isn't tied to any single provider's uptime. And the agent logic needs to be portable across runtimes.

Many companies want to build their own. [Ramp built a background agent](https://builders.ramp.com/post/why-we-built-our-background-agent) tailored to their engineering workflows. Others want agents tuned to their codebase, their security requirements, their internal tools. When you build your own, you control the system prompt, the tool layer, the approval policies, and the data. Nothing leaves your infrastructure that you haven't explicitly allowed.

Today we're open-sourcing a template that gives you a working starting point, built on Vercel's infrastructure primitives. It ships as a coding agent because that's the most immediate use case, but the patterns it demonstrates (long-running compute, durable workflows, multi-model orchestration, isolated execution) apply to any background agent you need to build.

## The infrastructure layer

Building a reliable background agent requires four things, and each maps to a Vercel primitive.

**[Sandboxes](https://vercel.com/docs/sandboxes): the agent's computer.** Each agent session gets its own isolated sandbox with a full runtime environment. The sandbox provides filesystem operations, process execution, and network endpoint mapping. It can be snapshotted, hibernated on inactivity, and restored exactly where it left off. The abstraction is provider-based, so you can swap in your own sandbox infrastructure.

**[Workflow](https://useworkflow.dev): durability and infinite compute.** The agent loop runs as a durable workflow where each step (model call, tool execution, result processing) can be retried independently on failure. The agent can run for minutes or hours, surviving restarts and recovering from transient failures without losing work. No request timeouts, no custom job queues.

**[AI Gateway](https://ai-sdk.dev/docs/ai-sdk-core/ai-gateway): model access and resilience.** All model calls route through AI Gateway, which provides access to hundreds of models from every major provider through a single endpoint. If a provider is down or rate-limited, requests fail over automatically. Provider-specific settings (thinking parameters, reasoning config, storage policies) are configured per model out of the box.

**[AI SDK](https://ai-sdk.dev): portable agent logic.** The agent runtime is built on the AI SDK, which provides the tool-calling loop, streaming, structured output, and framework integrations. The agent logic runs on Node.js, Bun, Deno, and serverless runtimes.

## What ships with the template

The primitives provide infrastructure. The template composes them into a complete system and adds the application-level patterns that make background agents useful:

- **Agent runtime** with a structured tool layer (file read/write, shell execution, code search, web fetch, task management) and a system prompt that encodes engineering best practices as hard constraints
- **Subagents** for task delegation: an explorer for read-only analysis, an executor for implementation work, and a designer for frontend interfaces, each running autonomously up to 100 tool steps
- **Auto-commit and auto-PR** with AI-generated commit messages, branch safety validation, PR deduplication, and race condition handling
- **Tool approvals** with human-in-the-loop control via the AI SDK, so destructive or sensitive actions require explicit approval before execution
- **Context management** with cache control and aggressive compaction to keep long-running sessions within token budgets
- **Skills system** for adding domain-specific capabilities (internal APIs, custom workflows, compliance checks) without modifying the core runtime
- **Model switching** through AI Gateway so users can select different models per task
- **Internal leaderboard** for comparing model performance across your team's usage

## Getting started

Clone the repo, run `bun install`, link your Vercel project, and start the dev server. The setup script configures OAuth for Vercel and GitHub and pulls your environment variables.

The template is designed to be forked. Swap model providers. Add tools for your internal systems. Change the system prompt. Replace the sandbox provider. Use it as a coding agent out of the box, or as the foundation for whatever background agent your team needs.

MIT-licensed. [Deploy on Vercel →](#) | [View on GitHub →](#)
