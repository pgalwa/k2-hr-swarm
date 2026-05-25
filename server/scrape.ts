import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runJobDiscoverySwarm, type DiscoveryJob } from "./swarm.js";

export type JobStatus = "pending" | "completed" | "failed";

export type JobRecord = {
  id: string;
  title: string;
  company: string;
  description: string;
  url: string;
  status: JobStatus;
  outputFile?: string;
  markdown_resume?: string;
  strategy_notes?: string[];
  createdAt: string;
  completedAt?: string;
};

const rootDir = path.resolve(process.cwd());
const jobsPath = path.join(rootDir, "data", "jobs.json");

async function readJobs(): Promise<JobRecord[]> {
  try {
    const raw = await readFile(jobsPath, "utf8");
    return JSON.parse(raw) as JobRecord[];
  } catch {
    return [];
  }
}

async function writeJobs(jobs: JobRecord[]) {
  await writeFile(jobsPath, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function deriveCompanyFromTitle(title: string) {
  const separators = [" at ", " - ", " | ", " · "];
  for (const separator of separators) {
    const parts = title.split(separator).map((part) => cleanText(part));
    if (parts.length > 1 && parts[1]) return parts[1];
  }
  return "Unknown Company";
}

function discoveryJobToRecord(job: DiscoveryJob, now: string): JobRecord {
  const tags = job.tags.length ? `Tags: ${job.tags.join(", ")}` : "";
  const description = [
    `Remote-first listing found directly by Kimi web-search swarm.`,
    `Source: ${job.source}`,
    job.location ? `Remote location: ${job.location}` : "Remote location: remote-first",
    tags,
    "",
    job.description
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: createId(),
    title: cleanText(job.title).slice(0, 160),
    company: cleanText(job.company).slice(0, 120),
    description,
    url: job.url,
    status: "pending",
    createdAt: now
  };
}

export async function seekRemoteFirstJobs(roleName: string): Promise<JobRecord[]> {
  const query = cleanText(roleName);
  if (!query) {
    throw new Error("Paste a job name to ask Kimi for remote-first roles.");
  }

  const discovery = await runJobDiscoverySwarm(query);
  if (discovery.selected_jobs.length === 0) {
    throw new Error("Kimi did not find any relevant remote-first jobs for that role.");
  }

  const now = new Date().toISOString();
  const jobs = discovery.selected_jobs.map((job) => discoveryJobToRecord(job, now));
  const existingJobs = await readJobs();
  await writeJobs([...jobs, ...existingJobs]);

  return jobs;
}

export async function scrapeJob(url: string): Promise<JobRecord> {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("Provide a valid http(s) job URL.");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36"
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);

    const extracted = await page.evaluate(() => {
      const selectors = [
        "[data-test='job-description']",
        "[data-testid='job-description']",
        ".jobs-description",
        ".job-description",
        ".jobsearch-jobDescriptionText",
        "article",
        "main"
      ];

      const firstUsefulNode = selectors
        .map((selector) => document.querySelector(selector))
        .find((node) => node?.textContent && node.textContent.trim().length > 400);

      const source = firstUsefulNode ?? document.body;
      const text = source?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const h1 = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
      const title = h1 || document.title.replace(/\s+/g, " ").trim() || "Untitled Role";

      const companySelectors = [
        "[data-test='company-name']",
        "[data-testid='company-name']",
        ".jobs-unified-top-card__company-name",
        ".company-name",
        "[class*='company']"
      ];
      const company =
        companySelectors
          .map((selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim())
          .find(Boolean) || "";

      return { title, company, text };
    });

    const title = cleanText(extracted.title).slice(0, 160) || "Untitled Role";
    const company = cleanText(extracted.company || deriveCompanyFromTitle(title)).slice(0, 120);
    const description = cleanText(extracted.text);

    if (description.length < 120) {
      throw new Error("Could not extract enough job description text from this page.");
    }

    const job: JobRecord = {
      id: createId(),
      title,
      company,
      description,
      url,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    const jobs = await readJobs();
    jobs.unshift(job);
    await writeJobs(jobs);

    return job;
  } finally {
    await browser.close();
  }
}
