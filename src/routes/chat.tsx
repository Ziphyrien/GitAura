import { createFileRoute } from "@tanstack/react-router"
import { Chat } from "@/components/chat"

type ChatSearch = {
  initialQuery?: string
  session?: string
}

export const Route = createFileRoute("/chat")({
  validateSearch: (search: ChatSearch) => ({
    initialQuery:
      typeof search.initialQuery === "string" && search.initialQuery.trim().length > 0
        ? search.initialQuery
        : undefined,
    session:
      typeof search.session === "string" && search.session.length > 0
        ? search.session
        : undefined,
  }),
  component: ChatRoute,
})

function ChatRoute() {
  return <Chat />
}
