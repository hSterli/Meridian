import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProjectTabs } from "@/components/layout/project-tabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, key")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  return (
    <div>
      <div className="-mx-8 -mt-8 border-b border-border-light bg-white px-8 pt-8">
        <Link
          href="/projects"
          className="text-xs font-ui-label font-semibold text-ink-tertiary hover:text-ink-secondary"
        >
          ← All projects
        </Link>
        <h1 className="font-headline-sm mt-1 text-xl font-semibold text-ink-primary">
          {project.name}{" "}
          <span className="text-sm font-normal text-ink-tertiary">{project.key}</span>
        </h1>
        <ProjectTabs projectId={project.id} />
      </div>
      <div className="py-6">{children}</div>
    </div>
  );
}
