// Shown for screens that don't exist yet, so nothing displays invented figures.
export function NotBuilt({ title, milestone, summary }: { title: string; milestone: number; summary: string }) {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">{title}</h1>
      <div className="rounded-2xl border border-dashed border-border bg-surface p-6">
        <p className="text-sm font-semibold text-muted">Not built yet · Milestone {milestone}</p>
        <p className="mt-2 text-sm">{summary}</p>
      </div>
    </section>
  );
}
