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
      <div className="border-b border-slate-200 bg-white px-6 pt-6">
        <Link href="/projects" className="text-xs font-medium text-slate-400 hover:text-slate-600">
          ← All projects
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          {project.name}{" "}
          <span className="text-sm font-normal text-slate-400">{project.key}</span>
        </h1>
        <ProjectTabs projectId={project.id} />
      </div>
      <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
    </div>
  );
}
