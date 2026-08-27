"use client";

import { useState } from "react";
import { Link as LinkIcon, Printer, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SnapshotShareActions() {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button type="button" variant="secondary" onClick={copyLink}>
        {copied ? <Check size={16} /> : <LinkIcon size={16} />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => window.print()}>
        <Printer size={16} />
        Print / Save as PDF
      </Button>
    </div>
  );
}
