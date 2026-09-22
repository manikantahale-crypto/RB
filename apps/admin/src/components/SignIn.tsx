/**
 * Who you are, in the brand bar.
 *
 * The authoring tool has no account system of its own: it signs in against the
 * same node-api the recruiters use, and admin-api verifies that token. So this
 * is deliberately small — an email, a password, and the name of whoever is
 * signed in.
 *
 * It matters more than it looks. Every version records who compiled it, who
 * asked for go-live and who approved, and a workflow cannot be approved by the
 * person who asked for it. With one hardcoded identity that rule refused every
 * approval; with this, two people are two people.
 */
import { useState } from "react";
import { currentSession, signIn, signOut, type Session } from "../lib/session.js";

export function SignIn() {
  const [session, setSession] = useState<Session | null>(() => currentSession());
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn(email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSession(res.session);
    setOpen(false);
    setEmail("");
    setPassword("");
    // Every screen fetched its data with the old identity; the simplest
    // correct thing is to load them again as the person who just signed in.
    window.location.reload();
  }

  if (session) {
    return (
      <div className="signin signin--in">
        <span className="signin-who" title={session.email}>
          {session.email}
        </span>
        <button
          type="button"
          className="signin-link"
          onClick={() => {
            signOut();
            setSession(null);
            window.location.reload();
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="signin">
      {!open ? (
        <button type="button" className="signin-link" onClick={() => setOpen(true)}>
          Sign in
        </button>
      ) : (
        <form className="signin-form" onSubmit={submit}>
          <input
            id="admin-signin-email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            id="admin-signin-password"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" className="signin-link" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      )}
      {error ? (
        <p className="signin-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
