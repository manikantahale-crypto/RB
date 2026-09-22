/**
 * WHO IS SIGNED IN, AND WHAT THEY MAY DO.
 *
 * `platform.org_members.role` has always said — 56 operators and one admin —
 * and node-api has always signed it into the token. The tool never asked, so
 * every screen offered every control to everybody and the server accepted it.
 *
 * ASKED FOR, NOT UNPACKED. The role is fetched from admin-api's `/me` rather
 * than read out of the JWT in the browser. A token is signed so a SERVER can
 * believe it; a client that decodes its own token and decides its own
 * permissions has decided nothing, and the habit is how a UI ends up trusting
 * a value somebody edited in devtools.
 *
 * WHICH IS WHY THIS IS NOT THE BOUNDARY EITHER. `admin-only.ts` in admin-api
 * refuses the request; this only decides what to draw. If the two ever
 * disagree the server wins and the person gets a plain sentence back. Hiding a
 * control an operator cannot use is courtesy — not offering them a button that
 * fails — and nothing more than that rests on it.
 *
 * UNKNOWN IS NOT ADMIN. Before the answer arrives, and if it never arrives,
 * the role reads as operator. A moment of showing an approve button that then
 * vanishes is worse than a moment without it.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { request } from "../api";

export type Role = "admin" | "operator";

export type Me = {
  id: string;
  email: string | null;
  orgId: string | null;
  role: Role;
  source: "token" | "anonymous";
  /** The acts the server reserves, in its words. Shown, never re-derived. */
  adminOnly: string[];
};

type MeState = { me: Me | null; loading: boolean };

const MeContext = createContext<MeState>({ me: null, loading: true });

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MeState>({ me: null, loading: true });

  useEffect(() => {
    let live = true;
    void request<Me>("/me").then((res) => {
      if (!live) return;
      setState({ me: res.ok ? res.data : null, loading: false });
    });
    return () => {
      live = false;
    };
  }, []);

  return <MeContext.Provider value={state}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  return useContext(MeContext);
}

/** The one question most screens ask. Unknown answers false. */
export function useIsAdmin(): boolean {
  return useContext(MeContext).me?.role === "admin";
}

/**
 * A control only an admin may use, with the reason in its place for everyone
 * else.
 *
 * The alternative — rendering the button disabled — leaves a person clicking
 * something that never responds and guessing why. A sentence saying who can do
 * this is shorter and answers the question.
 */
export function AdminOnly({
  children,
  instead,
}: {
  children: React.ReactNode;
  /** What an operator sees. Nothing, when the absence explains itself. */
  instead?: React.ReactNode;
}) {
  const isAdmin = useIsAdmin();
  if (isAdmin) return <>{children}</>;
  return <>{instead ?? null}</>;
}
