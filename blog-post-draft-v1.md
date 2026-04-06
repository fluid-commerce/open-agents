# Build your own background agent

**Published:** [Date] | **Authors:** [Authors] | **Category:** Templates

---

Every serious engineering team is arriving at the same conclusion: they need their own coding agent.

Not a chatbot. Not a copilot that autocompletes the current line. A background agent — one that takes a task, spins up a cloud environment, writes and tests code across an entire codebase, and opens a pull request when it's done. All while you're doing something else.

Ramp built one. They wrote about it publicly: "The craft of engineering is rapidly changing. We built our own coding agent to accelerate faster." The investment was significant — months of engineering time to build the sandbox infrastructure, tool system, agent runtime, and git automation that makes a background agent actually work.

Most teams can't make that investment. Until now, there was no starting point.

Today we're releasing [Template Name], an open-source Next.js template you can deploy on Vercel to run your own background coding agents in the cloud.

## Why background agents matter

The first wave of AI coding tools sat inside your editor. They helped you write code faster, but only while you were watching. You were still the bottleneck — context-switching between prompting, reviewing, and directing.

Background agents break that constraint. They run in isolated cloud sandboxes, work autonomously on tasks you assign, and return completed work as commits and pull requests. You can run several in parallel. You review their output the same way you'd review a colleague's — through code review, not chat.

This is how engineering velocity actually scales with AI: not by making individuals type faster, but by multiplying the number of tasks being worked on simultaneously.

## What's inside

[Template Name] gives you the full stack for building, running, and managing background coding agents.

### Agent runtime

The core is a complete agent system built on the AI SDK. It has a structured tool layer for file operations, shell execution, code search, web access, and task management. The agent reads your codebase, makes changes, runs your tests, and iterates until things pass — exactly the workflow a skilled engineer follows.

### Sandboxed cloud execution

Every agent session runs in its own isolated sandbox on Vercel. The sandbox has a full runtime environment — Node.js, Bun, package managers, git — so agents can build, test, and run your project the same way you would locally. Sandboxes can be snapshotted, hibernated, and restored, which means long-running tasks survive interruptions without losing state.

### Multi-agent delegation

Not every task requires the same approach. The system supports specialized subagents — an explorer for read-only codebase analysis, an executor for scoped implementation work, and a designer for high-quality frontend interfaces. The primary agent delegates to the right specialist based on what the task requires, the same way a senior engineer delegates across a team.

### Git-native workflows

Background agents are only useful if their work flows cleanly into your existing process. [Template Name] includes auto-commit and auto-PR capabilities — the agent can commit its changes directly or open pull requests against your repository. Authentication is handled through Vercel and GitHub OAuth, so agents operate with proper permissions from the start.

### Skills and extensibility

The agent runtime supports a skills system for extending capabilities without modifying the core. Skills are installable modules that add domain-specific knowledge or new tool integrations. The community can publish skills, and your team can build private ones for internal workflows.

### Built on the AI SDK

The agent layer is built on Vercel's AI SDK, with support for multiple model providers including OpenAI and Anthropic. Swap models per task, per subagent, or across your entire deployment. As new models ship, your agents get smarter without code changes.

## Who this is for

**Companies building agent platforms.** If you're like Ramp and want your own background agent tailored to your codebase, workflows, and security requirements, this is your starting point. Fork it, customize the tool layer, add your internal APIs, and deploy it behind your own auth.

**Teams that want agents working in parallel.** If your engineering org is bottlenecked on the number of tasks that can be in-flight at once, background agents change the math. Assign routine work — migrations, test coverage, dependency upgrades, bug fixes — and review the output.

**Developers exploring what's possible.** If you want to understand how production-grade AI coding agents actually work — the tool architecture, context management, sandbox lifecycle, multi-agent coordination — this is the reference implementation.

## Get started

Deploy [Template Name] to Vercel, connect your GitHub account, and start running agents against your repositories. The template handles auth, persistence, sandbox provisioning, and the agent runtime out of the box.

The entire codebase is open source. Read it, fork it, break it apart, rebuild it for your use case.

---

Every engineering team will eventually need their own agent infrastructure. The question is whether you build it from scratch or start from something that already works. [Template Name] is the starting point.

[Deploy on Vercel →](#) | [View on GitHub →](#)
