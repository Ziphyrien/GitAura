import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/chat", () => ({
  Chat: (props: { repoSource?: { owner: string; ref: string; repo: string } }) => (
    <div data-testid="chat-view">
      {props.repoSource
        ? `${props.repoSource.owner}/${props.repoSource.repo}@${props.repoSource.ref}`
        : "global"}
    </div>
  ),
}))

describe("chat routes", () => {
  it("renders the shared chat component on /chat", async () => {
    const { Route } = await import("@/routes/chat")

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("chat-view").textContent).toBe("global")
  })

  it("passes repo context into the shared chat component for repo routes", async () => {
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

    expect(screen.getByTestId("chat-view").textContent).toBe("acme/demo@main")
  })
})
