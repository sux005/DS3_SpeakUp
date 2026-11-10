import { PageShell } from "@/components/PageHeading";
import Image from "next/image";
import { Button, ButtonLink } from "@/components/Button";
import projects from "@/data/projects.json";
import { getTakes } from "@/lib/recordings";
export default function Home() {
  return (
    <PageShell>
      <section className="flex w-full flex-col gap-8 bg-night p-9 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col items-start gap-4">
          <p className="font-mono text-xs text-mint">YOUR PRACTICE SPACE</p>
          <h1 className="font-display text-4xl font-bold text-cream md:text-5xl">
            Supercool Motivational Message
          </h1>
          <p className="text-[17px] text-mint">Keep your recordings, feedback, and progress together.</p>
          <Button variant="accent">+ New presentation</Button>
        </div>
        <Image src="/figma/pip-home.svg" alt="" width={176} height={176} />
      </section>
      <h2 className="font-display text-[27px] font-bold text-ink">Your Presentations</h2>
      <ul className="w-full">
        {projects.items.map((project, index) => (
          <li key={project.project_id} className="flex flex-wrap items-start gap-6 border-t border-line p-6">
            <span className="w-12 font-mono text-[15px] text-rust">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <h3 className="font-display text-[25px] font-bold text-ink">{project.project_title}</h3>
              <p className="text-sm text-muted">{getTakes(project.project_id).length} attempts</p>
            </div>
            <ButtonLink variant="secondary" href={`/projects/${project.project_id}`}>
              Open project →
            </ButtonLink>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-muted">
        Private practice. Your recordings are visible only to your account.
      </p>

    </PageShell>
  );
}