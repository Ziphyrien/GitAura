import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "@webaura/ui/components/chat";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return <Chat />;
}
