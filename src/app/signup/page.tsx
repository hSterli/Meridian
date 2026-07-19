import { AuthForm } from "@/components/auth/auth-form";
import { signUp } from "@/lib/actions/auth";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Create your Meridian account</h1>
        <p className="mb-6 text-sm text-slate-500">
          First test run in under 20 minutes — no onboarding call required.
        </p>
        <AuthForm mode="signup" action={signUp} />
      </div>
    </div>
  );
}
