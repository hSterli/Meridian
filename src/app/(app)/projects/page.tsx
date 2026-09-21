import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";

export default async function ProjectsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, key, template, created_at")
    .eq("org_id", ctx.activeOrgId)
    .order("created_at", { ascending: false });

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Projects"
        action={
          <Link href="/projects/new">
            <Button>New project</Button>
          </Link>
        }
      />

      {!projects || projects.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-tertiary">
          No projects yet.{" "}
          <Link href="/projects/new" className="font-medium text-primary">
            Create your first one
          </Link>
          .
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}/test-cases`}>
              <Card className="p-5 transition-shadow hover:shadow-md">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
                  {p.key}
                </div>
                <div className="font-semibold text-ink-primary">{p.name}</div>
                <div className="mt-1 text-xs capitalize text-ink-tertiary">{p.template} template</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
