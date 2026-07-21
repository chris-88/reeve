import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

/**
 * Magic link rather than a password. Sessions persist and auto-refresh, so
 * this should be a once-ever screen on an installed home-screen app.
 */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold tracking-tight">Reeve</h1>
        <p className="mt-2 text-muted-foreground">Capture a thought, and it gets filed.</p>

        {state === "sent" ? (
          <p className="bg-card mt-8 rounded-xl border p-4 leading-relaxed">
            Check <span className="font-medium">{email}</span> for a sign-in link. Open it on
            this device.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-3">
            <Input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-14 rounded-xl px-4"
            />
            <Button
              type="submit"
              size="lg"
              disabled={state === "sending"}
              className="h-14 w-full rounded-xl text-base font-semibold"
            >
              {state === "sending" ? "Sending…" : "Send sign-in link"}
            </Button>
            {error && (
              <p role="alert" className="text-destructive">
                {error} Tap to try again.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
