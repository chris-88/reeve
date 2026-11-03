import { useState } from "react";
import { motion } from "motion/react";
import { supabase } from "@/lib/supabase";

/**
 * Email and password. A persisted, auto-refreshing session means signing in
 * once per device; this screen is rarely seen.
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
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
      setBusy(false);
    }
    // On success the auth listener in App swaps this screen out.
  }

  const field =
    "bg-surface hairline h-12 w-full rounded-[14px] border px-4 text-[15px] outline-none placeholder:text-muted-dim focus:border-hair-strong";

  return (
    <div className="pt-safe pb-safe grid h-full place-items-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-[40px] leading-none font-normal tracking-[-0.01em]">Reeve</h1>
        <p className="voice text-muted mt-3">Tell me anything. I'll take it from there.</p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <input
            type="email"
            required
            autoComplete="username"
            inputMode="email"
            placeholder="you@example.com"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          <motion.button
            type="submit"
            disabled={busy || !email.trim() || !password}
            whileTap={{ scale: 0.98 }}
            className="bg-brand text-brand-ink h-12 w-full rounded-full text-[15px] font-medium disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </motion.button>
          {error && (
            <p role="alert" className="text-danger text-[14px]">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
