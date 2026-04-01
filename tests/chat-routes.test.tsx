import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/chat", () => ({
  Chat: (props: {
    repoSource?: { owner: string; ref?: string; repo: string }
    sessionId?: string
  }) => (
    <div data-testid="chat-view">
      {props.sessionId
        ? `session:${props.sessionId}`
        : props.repoSource
        ? `${props.repoSource.owner}/${props.repoSource.repo}${props.repoSource.ref ? `@${props.repoSource.ref}` : ""}`
        : "global"}
    </div>
  ),
}))

vi.mock("@/components/resolved-repo-chat", () => ({
  ResolvedRepoChat: (props: {
    repoTarget: {
      owner: string
      ref?: string
      refPathTail?: string
      repo: string
    }
  }) => (
    <div data-testid="resolved-repo-chat">
      {props.repoTarget.owner}/{props.repoTarget.repo}
      {props.repoTarget.ref ? `@${props.repoTarget.ref}` : ""}
      {props.repoTarget.refPathTail ? `#${props.repoTarget.refPathTail}` : ""}
    </div>
  ),
}))

describe("chat routes", () => {
  it("renders the shared chat component on /chat", async () => {
    const { Route } = await import("@/routes/chat.index")

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("chat-view").textContent).toBe("global")
  })

  it("passes the repo root target into the resolved repo boundary", async () => {
    const { Route } = await import("@/routes/$owner.$repo.index")
    vi.spyOn(Route, "useParams").mockReturnValue({
      owner: "acme",
      repo: "demo",
    })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("resolved-repo-chat").textContent).toBe("acme/demo")
  })

  it("passes slash refs through the resolved repo boundary for splat routes", async () => {
    const { Route } = await import("@/routes/$owner.$repo.$")
    vi.spyOn(Route, "useParams").mockReturnValue({
      _splat: "feature/foo",
      owner: "acme",
      repo: "demo",
    })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("resolved-repo-chat").textContent).toBe(
      "acme/demo@feature/foo"
    )
  })

  it("parses deep tree URLs into ref tails before resolution", async () => {
    const { Route } = await import("@/routes/$owner.$repo.$")
    vi.spyOn(Route, "useParams").mockReturnValue({
      _splat: "tree/feature/foo/src/lib",
      owner: "acme",
      repo: "demo",
    })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("resolved-repo-chat").textContent).toBe(
      "acme/demo#feature/foo/src/lib"
    )
  })

  it("passes the session id into the shared chat component for session routes", async () => {
    const { Route } = await import("@/routes/chat.$sessionId")
    vi.spyOn(Route, "useParams").mockReturnValue({
      sessionId: "session-1",
    })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("chat-view").textContent).toBe("session:session-1")
  })
})
