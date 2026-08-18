import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Builder] UI error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="builder-error-fallback">
          <h2>Something went wrong loading the Builder</h2>
          <p className="muted">
            The page crashed in the browser. Try a hard refresh (Ctrl+F5). If it
            keeps happening, share this message with your team.
          </p>
          <pre className="builder-error-pre">{this.state.error.message}</pre>
          <button
            type="button"
            className="btn btn--compact"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload page
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
