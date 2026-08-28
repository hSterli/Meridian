import { notFound } from "next/navigation";
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
    .select("id")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  return (
    <div>
      <ProjectTabs projectId={project.id} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
