import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { TestCaseForm } from "@/components/test-cases/test-case-form";
import { createTestCase } from "@/lib/actions/test-cases";

export default async function NewTestCasePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const action = createTestCase.bind(null, projectId);

  return (
    <div className="max-w-2xl">
      <PageHeader title="New test case" />
      <Card className="p-6">
        <TestCaseForm action={action} submitLabel="Create test case" />
      </Card>
    </div>
  );
}
