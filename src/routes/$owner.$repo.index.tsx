import { createFileRoute } from "@tanstack/react-router"
import { ChatPage } from "@/components/chat-page"

export const Route = createFileRoute("/$owner/$repo/")({
  component: RepoChatRoute,
})

function RepoChatRoute() {
  return <ChatPage />
}
