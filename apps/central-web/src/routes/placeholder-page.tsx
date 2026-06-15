interface PlaceholderPageProps {
  title: string;
  summary: string;
}

export function PlaceholderPage({ title, summary }: PlaceholderPageProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Pending</p>
          <h2 className="panel-title">{title}</h2>
        </div>
      </div>
      <p className="panel-copy">{summary}</p>
    </section>
  );
}
