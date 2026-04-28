import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "@webaura/ui/components/chat";

export const Route = createFileRoute("/chat/$sessionId")({
  component: SessionChatRoute,
});

function SessionChatRoute() {
  const { sessionId } = Route.useParams();

  return <Chat sessionId={sessionId} />;
}
