import React from "react";
import ReactDOM from "react-dom/client";
import ReactMarkdown from "react-markdown";
import "./styles.css";

type JobStatus = "pending" | "completed" | "failed";

type Job = {
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

const api = {
  async jobs(): Promise<Job[]> {
    const response = await fetch("/api/jobs");
    if (!response.ok) throw new Error("Failed to load jobs.");
    return response.json();
  },
  async addTarget(value: string): Promise<Job[]> {
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: value })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not add job.");
    return Array.isArray(body) ? body : [body];
  },
  async generate(jobId: string): Promise<Job> {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Generation failed.");
    return body;
  }
};

function statusLabel(status: JobStatus) {
  if (status === "completed") return "DONE";
  if (status === "failed") return "FAIL";
  return "PENDING";
}

function App() {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState<"scrape" | "generate" | null>(null);
  const [error, setError] = React.useState("");

  const selected = jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null;

  async function refresh() {
    const list = await api.jobs();
    setJobs(list);
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }

  React.useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function handleScrape(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy("scrape");
    try {
      const foundJobs = await api.addTarget(target);
      setJobs((current) => [...foundJobs, ...current]);
      setSelectedId(foundJobs[0]?.id ?? null);
      setTarget("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add job.");
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    if (!selected) return;
    setError("");
    setBusy("generate");
    try {
      const updated = await api.generate(selected.id);
      setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="grid min-h-screen grid-cols-[340px_1fr]">
        <aside className="border-r border-neutral-800 bg-neutral-950">
          <div className="border-b border-neutral-800 p-5">
            <div className="mb-5">
              <h1 className="font-mono text-lg uppercase tracking-[0.18em] text-white">Hybrid Hunter</h1>
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-neutral-500">local / zero auth / ATS adversary</p>
            </div>
            <form onSubmit={handleScrape} className="space-y-3">
              <input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="Paste job name"
                className="h-11 w-full border border-neutral-800 bg-black px-3 font-mono text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
              />
              <button
                disabled={!target || busy === "scrape"}
                className="h-11 w-full border border-neutral-700 bg-neutral-100 px-3 font-mono text-xs uppercase tracking-[0.16em] text-black transition hover:bg-white disabled:cursor-not-allowed disabled:border-neutral-900 disabled:bg-neutral-800 disabled:text-neutral-500"
              >
                {busy === "scrape" ? "Seeking" : "Seek Remote"}
              </button>
            </form>
            {error ? <p className="mt-4 border border-red-900 bg-red-950/40 p-3 font-mono text-xs text-red-200">{error}</p> : null}
          </div>

          <div className="max-h-[calc(100vh-219px)] overflow-y-auto">
            {jobs.length === 0 ? (
              <div className="p-5 font-mono text-sm text-neutral-500">No jobs yet.</div>
            ) : (
              jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  className={`block w-full border-b border-neutral-900 p-4 text-left transition hover:bg-neutral-900 ${
                    selected?.id === job.id ? "bg-neutral-900" : "bg-neutral-950"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-100">{job.title}</p>
                      <p className="mt-1 truncate font-mono text-xs text-neutral-500">{job.company}</p>
                    </div>
                    <span className="border border-neutral-700 px-2 py-1 font-mono text-[10px] uppercase text-neutral-400">
                      {statusLabel(job.status)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="min-w-0">
          {selected ? (
            <div className="grid h-screen grid-cols-2">
              <section className="min-w-0 border-r border-neutral-800">
                <header className="border-b border-neutral-800 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-500">{selected.company}</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">{selected.title}</h2>
                  {selected.url ? (
                    <a href={selected.url} target="_blank" rel="noreferrer" className="mt-2 block truncate font-mono text-xs text-neutral-500 hover:text-neutral-200">
                      {selected.url}
                    </a>
                  ) : (
                    <p className="mt-2 font-mono text-xs text-neutral-500">manual target</p>
                  )}
                </header>
                <div className="h-[calc(100vh-126px)] overflow-y-auto p-5">
                  <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-neutral-300">{selected.description}</pre>
                </div>
              </section>

              <section className="min-w-0 bg-black">
                <header className="flex min-h-[126px] items-center justify-between gap-4 border-b border-neutral-800 p-5">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-500">Swarm Output</p>
                    <p className="mt-2 font-mono text-sm text-neutral-300">
                      {selected.outputFile ? selected.outputFile : "No tailored resume generated."}
                    </p>
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={busy === "generate"}
                    className="h-11 shrink-0 border border-neutral-700 bg-neutral-100 px-4 font-mono text-xs uppercase tracking-[0.16em] text-black transition hover:bg-white disabled:cursor-not-allowed disabled:border-neutral-900 disabled:bg-neutral-800 disabled:text-neutral-500"
                  >
                    {busy === "generate" ? "Running" : "Generate Resume"}
                  </button>
                </header>
                <div className="h-[calc(100vh-126px)] overflow-y-auto p-5">
                  {selected.markdown_resume ? (
                    <div className="space-y-8">
                      <article className="rendered-markdown">
                        <ReactMarkdown>{selected.markdown_resume}</ReactMarkdown>
                      </article>
                      <section className="border-t border-neutral-800 pt-5">
                        <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-neutral-500">Strategy Notes</h3>
                        <ul className="mt-4 space-y-3">
                          {(selected.strategy_notes ?? []).map((note, index) => (
                            <li key={index} className="border-l border-neutral-700 pl-4 font-mono text-sm leading-6 text-neutral-300">
                              {note}
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center border border-dashed border-neutral-800">
                      <p className="font-mono text-sm uppercase tracking-[0.16em] text-neutral-600">Awaiting swarm run</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="flex h-screen items-center justify-center">
              <p className="font-mono text-sm uppercase tracking-[0.16em] text-neutral-600">Paste a job name to begin</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
