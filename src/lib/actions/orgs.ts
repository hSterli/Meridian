"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { ProjectTemplate } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

const TEMPLATE_SEED_CASES: Record<ProjectTemplate, { title: string; steps: { step: string; expected: string }[] }[]> = {
  web: [
    {
      title: "User can log in with valid credentials",
      steps: [
        { step: "Navigate to the login page", expected: "Login form is visible" },
        { step: "Enter valid email and password, submit", expected: "User is redirected to the dashboard" },
      ],
    },
    {
      title: "User sees validation error on invalid email",
      steps: [{ step: "Enter a malformed email and submit", expected: "Inline validation error is shown" }],
    },
  ],
  mobile: [
    {
      title: "App launches to onboarding on first install",
      steps: [{ step: "Fresh install and open the app", expected: "Onboarding carousel is shown" }],
    },
  ],
  api: [
    {
      title: "GET /health returns 200",
      steps: [{ step: "Send GET request to /health", expected: "Response status is 200 with { status: \"ok\" }" }],
    },
  ],
  blank: [],
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export async function createOrganizationAndProject(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  const template = (String(formData.get("template") ?? "blank") as ProjectTemplate) || "blank";

  if (!orgName || !projectName) {
    return { error: "Organization and first project names are required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be logged in." };
  }

  const limitError = await rateLimit("create_organization", 10, 86400);
  if (limitError) return { error: limitError };

  const orgSlug = `${slugify(orgName)}-${Math.random().toString(36).slice(2, 7)}`;

  // Creates the org and the owner's membership atomically via a SECURITY
  // DEFINER function — a plain client-side insert().select() would fail
  // here, because the SELECT policy for organizations requires org
  // membership that can't exist until *after* this same statement.
  const { data: org, error: orgError } = await supabase.rpc("create_organization_with_owner", {
    org_name: orgName,
    org_slug: orgSlug,
  });

  if (orgError || !org) {
    return { error: orgError?.message ?? "Could not create organization." };
  }

  const projectKey = slugify(projectName).slice(0, 10).toUpperCase();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      org_id: org.id,
      name: projectName,
      key: projectKey || "PROJ",
      template,
      created_by: user.id,
    })
    .select()
    .single();

  if (projectError || !project) {
    return { error: projectError?.message ?? "Could not create project." };
  }

  const seedCases = TEMPLATE_SEED_CASES[template] ?? [];
  if (seedCases.length > 0) {
    await supabase.from("test_cases").insert(
      seedCases.map((tc) => ({
        project_id: project.id,
        title: tc.title,
        steps: tc.steps,
        created_by: user.id,
      }))
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, org.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect(`/projects/${project.id}/test-cases`);
}

export async function switchActiveOrg(orgId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard");
}
