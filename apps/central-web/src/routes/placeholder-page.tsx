interface PlaceholderPageProps {
  title: string;
  summary: string;
}

export function PlaceholderPage({ title, summary }: PlaceholderPageProps) {
  return (
    <div className="min-h-screen px-8 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[28px] border border-[var(--line)] bg-[var(--card)] px-8 py-8 shadow-[0_0_0_1px_rgba(17,24,39,0.04)]">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Central Web</p>
          <h2 className="mt-3 text-4xl tracking-tight text-[var(--display)]">{title}</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--muted)]">{summary}</p>
        </div>
      </div>
    </div>
  );
}
