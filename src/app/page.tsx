import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";

export default async function RootPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (ctx.memberships.length === 0) redirect("/onboarding");
  redirect("/dashboard");
}
