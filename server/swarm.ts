import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JobRecord } from "./scrape.js";

export type SwarmOutput = {
  markdown_resume: string;
  strategy_notes: string[];
  outputFile: string;
};

export type DiscoveryJob = {
  source: string;
  title: string;
  company: string;
  location?: string;
  tags: string[];
  url: string;
  description: string;
};

export type DiscoverySwarmOutput = {
  selected_jobs: DiscoveryJob[];
  strategy_notes: string[];
};

const rootDir = path.resolve(process.cwd());
const profilePath = path.join(rootDir, "data", "profile.md");
const outputDir = path.join(rootDir, "output");

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Kimi response did not contain a JSON object.");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function getKimiConfig() {
  if (process.env.MOONSHOT_API_KEY) {
    return {
      provider: "Moonshot",
      apiKey: process.env.MOONSHOT_API_KEY,
      baseUrl: process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1/chat/completions",
      model: process.env.KIMI_MODEL ?? "kimi-k2.6",
      headers: {} as Record<string, string>
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: "OpenRouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      model: process.env.KIMI_MODEL ?? "moonshotai/kimi-k2.6",
      headers: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:5173",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "Hybrid Hunter"
      } as Record<string, string>
    };
  }

  throw new Error("Missing Kimi API key. Set MOONSHOT_API_KEY for Kimi/Moonshot or OPENROUTER_API_KEY for OpenRouter.");
}

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
};

async function kimiJson(systemPrompt: string, userPrompt: string, options: { webSearch?: boolean } = {}) {
  const config = getKimiConfig();
  if (options.webSearch && config.provider !== "Moonshot") {
    throw new Error("Kimi web search requires MOONSHOT_API_KEY. OpenRouter is not used for job discovery.");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  for (let turn = 0; turn < 8; turn += 1) {
    const body: Record<string, unknown> = {
      model: config.model,
      temperature: options.webSearch ? 0.6 : 1,
      max_tokens: options.webSearch ? 32768 : undefined,
      messages,
      response_format: { type: "json_object" }
    };

    if (options.webSearch) {
      body.thinking = { type: "disabled" };
      body.tools = [
        {
          type: "builtin_function",
          function: { name: "$web_search" }
        }
      ];
    }

    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...config.headers
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`${config.provider} request failed (${response.status}): ${responseBody}`);
    }

    const payload = await response.json();
    const choice = payload?.choices?.[0];
    const message = choice?.message;
    if (!message) throw new Error(`${config.provider} returned an empty response.`);

    if (choice.finish_reason === "tool_calls" && Array.isArray(message.tool_calls)) {
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls
      });

      for (const toolCall of message.tool_calls) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: toolCall.function.arguments
        });
      }

      continue;
    }

    if (!message.content) throw new Error(`${config.provider} returned an empty final response.`);
    return extractJson(message.content);
  }

  throw new Error("Kimi web search did not finish within the local tool-call limit.");
}

export async function runJobDiscoverySwarm(query: string, limit = 50): Promise<DiscoverySwarmOutput> {
  const requestedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const systemPrompt = `You are Kimi K2.6 acting as a remote-job discovery swarm.

Operate as three internal agents:
- Agent 1: Source-diverse web scout. Use your built-in web search to find current remote-first job listings on the public web across many source categories.
- Agent 2: Relevance adversary. Reject loose keyword traps. For a query like "React Native", reject roles where React Native appears only as a buried tag but the role is marketing, editor, sales, recruiter, or unrelated product/content work.
- Agent 3: Remote-first guard. Keep only remote-first jobs. Reject onsite, hybrid-only, location-locked roles unless the listing is explicitly remote-first.
- Agent 4: Source balance auditor. Prevent over-reliance on one board. Prefer source diversity when relevance is similar.

Source coverage targets:
- Remote-only boards: Remote OK, We Work Remotely, Remotive, Working Nomads, Himalayas, FlexJobs-style listings when accessible.
- Large job boards: LinkedIn Jobs, Indeed, Wellfound, Otta/Welcome to the Jungle, Glassdoor, Built In, Dice, ZipRecruiter.
- Startup and VC boards: Y Combinator companies, Wellfound startups, a16z portfolio jobs, Sequoia/SignalFire/Index/Accel portfolio career pages when visible.
- Direct company career pages: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, BambooHR, Personio, Teamtailor, company /careers pages.
- Developer communities: GitHub org career pages, Hacker News "Who is hiring" posts, niche React Native/mobile/frontend communities with job posts.
- Regional remote sources: EU remote boards and company pages with Europe/EMEA remote constraints.

Hard rules:
- Select only jobs matching the typed role intent, not broad keyword noise.
- Prefer title, seniority, tags, and actual responsibilities over one-off words in long descriptions.
- Search multiple source categories before finalizing. Do not return all requested jobs from a single source unless no other relevant sources exist.
- Aim for no more than 10 jobs from the same source domain when equally relevant alternatives exist.
- Search job boards, ATS-hosted job pages, direct company career pages, startup portfolio boards, and remote-only boards directly.
- Return real listings only. Do not invent companies, URLs, or descriptions.
- Prefer canonical job URLs over aggregator duplicates.
- Deduplicate the same role across aggregator and company pages, keeping the direct company/ATS page when available.
- If fewer than the requested number are truly relevant, return fewer. Precision beats volume.
- Return only valid JSON with this exact shape:
{
  "selected_jobs": [
    {
      "source": "job board or company careers site",
      "title": "role title",
      "company": "company name",
      "location": "remote location constraints",
      "tags": ["React Native", "TypeScript"],
      "url": "https://...",
      "description": "short factual summary of the listing and why it matches"
    }
  ],
  "strategy_notes": ["note 1", "note 2", "note 3"]
}`;

  const parsed = (await kimiJson(
    systemPrompt,
    `Find up to ${requestedLimit} current remote-first job listings for this typed role query: "${query}".

Use web search aggressively and diversify sources. Search exact role titles, close role variants, remote-first wording, and ATS-hosted job pages. Run searches across remote-only boards, major job boards, startup/VC boards, direct company career pages, and developer community listings before choosing the final set. Keep the output factual and machine-readable.`,
    { webSearch: true }
  )) as Partial<DiscoverySwarmOutput>;

  if (!Array.isArray(parsed.selected_jobs)) {
    throw new Error("Kimi discovery swarm did not return selected_jobs.");
  }

  return {
    selected_jobs: parsed.selected_jobs
      .filter((job) => job?.url && job?.title && job?.company)
      .slice(0, requestedLimit)
      .map((job) => ({
        source: String(job.source ?? "Kimi web search"),
        title: String(job.title),
        company: String(job.company),
        location: job.location ? String(job.location) : undefined,
        tags: Array.isArray(job.tags) ? job.tags.map(String).slice(0, 20) : [],
        url: String(job.url),
        description: String(job.description ?? "")
      })),
    strategy_notes: Array.isArray(parsed.strategy_notes) ? parsed.strategy_notes.slice(0, 3) : []
  };
}

export async function runSwarm(job: JobRecord): Promise<SwarmOutput> {
  const profile = await readFile(profilePath, "utf8");

  const systemPrompt = `You are Kimi K2.6 acting as a multi-agent adversarial resume swarm.

Ground truth profile:
${profile}

Operate as three internal agents:
- Agent 1: Analyze the unwritten business requirements of the job, including hidden stakeholder, delivery, implementation, and ATS intent.
- Agent 2: Rewrite the resume to highlight React, React Native, Flutter/Angular transition capability, frontend architecture, pre-sales discovery, stakeholder translation, and agent architecture orchestration.
- Agent 3: Ensure Python and backend execution are minimized to avoid corporate ATS miscategorization. Python may appear only as a side-skill when absolutely useful.

Return only valid JSON with this exact shape:
{
  "markdown_resume": "fully tailored resume in markdown",
  "strategy_notes": ["bullet 1", "bullet 2", "bullet 3"]
}

Tone: stoic, minimalist, specific, direct, and unpolished. No generic corporate AI fluff. No invented employers, degrees, dates, certifications, or quantified claims.`;

  const userPrompt = `Target this job.

Company: ${job.company}
Role: ${job.title}
URL: ${job.url}

Job description:
${job.description}`;

  const parsed = (await kimiJson(systemPrompt, userPrompt)) as {
    markdown_resume?: string;
    strategy_notes?: string[];
  };

  if (!parsed.markdown_resume || !Array.isArray(parsed.strategy_notes)) {
    throw new Error("Swarm output did not match the required JSON shape.");
  }

  await mkdir(outputDir, { recursive: true });
  const fileName = `${slug(job.company || "company")}_${slug(job.title || "role")}.md`;
  const outputFile = path.join(outputDir, fileName);
  const markdown = `${parsed.markdown_resume.trim()}

## Strategy Notes

${parsed.strategy_notes.map((note) => `- ${note}`).join("\n")}
`;

  await writeFile(outputFile, markdown, "utf8");

  return {
    markdown_resume: parsed.markdown_resume,
    strategy_notes: parsed.strategy_notes.slice(0, 3),
    outputFile
  };
}
