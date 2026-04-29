import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@webaura/ui/components/chat", () => ({
  Chat: (props: { sessionId?: string }) => (
    <div data-testid="chat-view">{props.sessionId ? `session:${props.sessionId}` : "global"}</div>
  ),
}));

describe("chat routes", () => {
  it("renders the shared chat component on /", async () => {
    const { Route } = await import("@/routes/index");
    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("global");
  });

  it("renders the shared chat component on /chat", async () => {
    const { Route } = await import("@/routes/chat.index");
    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("global");
  });

  it("passes the session id into the shared chat component for session routes", async () => {
    const { Route } = await import("@/routes/chat.$sessionId");
    vi.spyOn(Route, "useParams").mockReturnValue({
      sessionId: "session-1",
    });

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("session:session-1");
  });
});
