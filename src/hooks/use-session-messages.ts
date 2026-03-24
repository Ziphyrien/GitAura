import { useLiveQuery } from "dexie-react-hooks"
import { getSessionMessages } from "@/db/schema"

export function useSessionMessages(sessionId: string | undefined) {
  return useLiveQuery(async () => {
    if (!sessionId) {
      return []
    }

    return await getSessionMessages(sessionId)
  }, [sessionId])
}
