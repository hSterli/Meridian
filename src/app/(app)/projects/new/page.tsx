import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { NewProjectForm } from "@/components/projects/new-project-form";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-lg px-6 py-8">
      <PageHeader title="New project" />
      <Card className="p-6">
        <NewProjectForm />
      </Card>
    </div>
  );
}
