"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { bulkImportTestCases } from "@/lib/actions/test-cases";

export function ImportCsvForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setIsPending(true);
    setError(undefined);
    const result = await bulkImportTestCases(projectId, {}, formData);
    setIsPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setOpen(false);
      formRef.current?.reset();
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Import CSV
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import test cases from CSV">
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-3">
          <input
            type="file"
            name="file"
            accept=".csv"
            required
            className="text-xs text-ink-secondary file:mr-2 file:rounded-md file:border-0 file:bg-paper-muted file:px-2 file:py-1.5 file:text-xs file:font-medium"
          />
          <Button type="submit" variant="secondary" disabled={isPending}>
            {isPending ? "Importing…" : "Import"}
          </Button>
          {error && <span className="text-xs text-fail">{error}</span>}
        </form>
      </Modal>
    </>
  );
}
