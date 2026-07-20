import { AuthForm } from "@/components/auth/auth-form";
import { signIn } from "@/lib/actions/auth";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-surface px-4">
      <div className="w-full max-w-sm rounded-xl border border-border-light bg-white p-8 shadow-sm">
        <h1 className="font-headline-md mb-1 text-[22px] font-semibold text-ink-primary">
          Log in to Meridian
        </h1>
        <p className="mb-6 text-sm text-ink-secondary">
          Test management that gets out of your way.
        </p>
        <AuthForm mode="login" action={signIn} />
      </div>
    </div>
  );
}
