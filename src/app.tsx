import { useEffect, useState, type FormEvent } from "react";

import { PostalLogo } from "@/components/postal-logo";
import { Button } from "@/components/ui/button";
import { WebMcpLab } from "@/lab/webmcp-lab";
import {
  isDemoLoginAvailable,
  requestLoginCode,
  resolveClientSession,
  signIn,
  signInWithAccessCode,
  signOut,
  type PostalUser,
} from "@/postal/session";

function SignInForm({ onSignedIn }: { onSignedIn: (user: PostalUser) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"code" | "signin" | "access" | null>(null);

  const run = async (kind: "code" | "signin" | "access", action: () => Promise<void>) => {
    setPending(kind);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setPending(null);
    }
  };

  const sendCode = (event: FormEvent) => {
    event.preventDefault();
    void run("code", async () => {
      await requestLoginCode(email);
      setCodeSent(true);
    });
  };

  const verifyCode = (event: FormEvent) => {
    event.preventDefault();
    void run("signin", async () => onSignedIn(await signIn(email, code)));
  };

  const useAccessCode = (event: FormEvent) => {
    event.preventDefault();
    void run("access", async () =>
      onSignedIn(await signInWithAccessCode(accessCode)),
    );
  };

  const inputClass =
    "h-11 w-full rounded-[12px] bg-neutral-50 px-3.5 text-sm text-content outline-none ring-1 ring-neutral-175 transition placeholder:text-content-subtle/70 focus:bg-background-light focus:ring-neutral-200 disabled:text-content-subtle";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-5">
        <PostalLogo size={26} />
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-content">
            Sign in to the Lab
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-content-subtle">
            Use your Postal account. Agent tools act as you, with the same
            permissions you already have.
          </p>
        </div>
      </div>

      <form
        onSubmit={codeSent ? verifyCode : sendCode}
        className="flex flex-col gap-4 rounded-[20px] bg-background-light p-5 shadow-[0_12px_40px_rgba(24,24,24,0.06)] ring-1 ring-neutral-175"
      >
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-content" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            disabled={codeSent}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@label.com"
            className={inputClass}
          />
        </div>

        {codeSent && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-content" htmlFor="code">
              Sign-in code
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="······"
              className={`${inputClass} font-mono tracking-[0.3em]`}
            />
            <p className="mt-0.5 text-xs text-content-subtle">
              Sent to {email}.{" "}
              <button
                type="button"
                className="font-medium text-content underline underline-offset-2"
                onClick={() => {
                  setCodeSent(false);
                  setCode("");
                }}
              >
                Change
              </button>
            </p>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        <Button
          type="submit"
          className="mt-1 w-full"
          isLoading={pending === "code" || pending === "signin"}
          loadingText={codeSent ? "Signing in" : "Sending code"}
        >
          {codeSent ? "Sign in" : "Email me a code"}
        </Button>
      </form>

      {isDemoLoginAvailable() && (
        <form onSubmit={useAccessCode} className="flex flex-col gap-3 px-1">
          <p className="text-xs leading-relaxed text-content-subtle">
            Reviewing this project? Use the access code from the submission form.
          </p>
          <div className="flex items-center gap-2">
            <input
              aria-label="Reviewer access code"
              required
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="Access code"
              className={`${inputClass} h-10 flex-1`}
            />
            <Button
              type="submit"
              variant="secondary"
              className="h-10 shrink-0"
              isLoading={pending === "access"}
              loadingText="Opening"
            >
              Open demo
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<PostalUser | null | undefined>(undefined);

  useEffect(() => {
    void resolveClientSession().then(setUser);
  }, []);

  if (user === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-content-subtle">
        Loading…
      </div>
    );
  }

  if (user === null) return <SignInForm onSignedIn={setUser} />;

  return (
    <>
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <PostalLogo />
            <span className="rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-medium text-accent">
              Labs
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-content-subtle sm:inline">
              {user.email ?? user.name}
            </span>
            <button
              type="button"
              onClick={() => void signOut().then(() => setUser(null))}
              className="text-xs font-medium text-content-subtle transition hover:text-content"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <WebMcpLab />
    </>
  );
}
