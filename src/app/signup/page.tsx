import { AuthForm } from "@/components/auth/auth-form";
import { signUp } from "@/lib/actions/auth";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-surface px-4">
      <div className="w-full max-w-sm rounded-xl border border-border-light bg-white p-8 shadow-sm">
        <h1 className="font-headline-md mb-1 text-[22px] font-semibold text-ink-primary">
          Create your Meridian account
        </h1>
        <p className="mb-6 text-sm text-ink-secondary">
          First test run in under 20 minutes — no onboarding call required.
        </p>
        <AuthForm mode="signup" action={signUp} />
      </div>
    </div>
  );
}
