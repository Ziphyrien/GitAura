import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a data-to={to}>{children}</a>
  ),
}));

vi.mock("@webaura/ui/components/chat-logo", () => ({
  ChatLogo: () => <div>logo</div>,
}));

vi.mock("@webaura/ui/components/button", () => ({
  Button: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? children : <button type="button">{children}</button>,
}));

describe("LandingPage", () => {
  it("links directly into plain chat", async () => {
    const { LandingPage } = await import("@/components/landing-page");

    render(<LandingPage />);

    expect(screen.getByText(/Start with a normal chat/i)).toBeTruthy();
    expect(screen.getByText("Start chatting").closest("a")?.getAttribute("data-to")).toBe("/chat");
  });
});
