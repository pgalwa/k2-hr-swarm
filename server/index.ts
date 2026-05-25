import "dotenv/config";
import cors from "cors";
import express from "express";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { scrapeJob, seekRemoteFirstJobs, type JobRecord } from "./scrape.js";
import { runSwarm } from "./swarm.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const rootDir = path.resolve(process.cwd());
const jobsPath = path.join(rootDir, "data", "jobs.json");

app.use(cors());
app.use(express.json({ limit: "2mb" }));

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

app.get("/api/jobs", async (_request, response) => {
  response.json(await readJobs());
});

app.post("/api/scrape", async (request, response) => {
  try {
    const { url, limit } = request.body as { url?: string; limit?: number };
    const value = url?.trim() ?? "";
    const requestedLimit = Number.isFinite(limit) ? Number(limit) : 50;
    const job = /^https?:\/\//i.test(value) ? await scrapeJob(value) : await seekRemoteFirstJobs(value, requestedLimit);
    response.status(201).json(job);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Could not add job." });
  }
});

app.post("/api/generate", async (request, response) => {
  try {
    const { jobId } = request.body as { jobId?: string };
    if (!jobId) return response.status(400).json({ error: "jobId is required." });

    const jobs = await readJobs();
    const jobIndex = jobs.findIndex((job) => job.id === jobId);
    if (jobIndex === -1) return response.status(404).json({ error: "Job not found." });

    const output = await runSwarm(jobs[jobIndex]);
    jobs[jobIndex] = {
      ...jobs[jobIndex],
      status: "completed",
      markdown_resume: output.markdown_resume,
      strategy_notes: output.strategy_notes,
      outputFile: output.outputFile,
      completedAt: new Date().toISOString()
    };
    await writeJobs(jobs);

    response.json(jobs[jobIndex]);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Resume generation failed." });
  }
});

app.listen(port, () => {
  console.log(`Hybrid Hunter API listening on http://localhost:${port}`);
});
