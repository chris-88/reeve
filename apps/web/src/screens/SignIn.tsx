import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

/**
 * Email and password.
 *
 * Magic links were the first attempt and are a bad fit here: Supabase's free
 * tier allows two auth emails per hour, links are single-use and get burned by
 * mail-client prefetching, and on iOS they open in Safari rather than the
 * installed PWA, so the session lands in the wrong browser.
 *
 * A password with a persisted, auto-refreshing session means signing in once.
 */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "That email and password don't match. Check and try again."
          : error.message,
      );
      setBusy(false);
    }
    // On success the auth listener in App swaps this screen out.
  }

  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold tracking-tight">Reeve</h1>
        <p className="text-muted-foreground mt-2">Capture a thought, and it gets filed.</p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <Input
            type="email"
            required
            autoComplete="username"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-14 rounded-xl px-4"
          />
          <Input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-14 rounded-xl px-4"
          />
          <Button
            type="submit"
            size="lg"
            disabled={busy || !email.trim() || !password}
            className="h-14 w-full rounded-xl text-base font-semibold"
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
