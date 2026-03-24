import { useLiveQuery } from "dexie-react-hooks"
import { listSessionMetadata } from "@/db/schema"

export function useSessionList() {
  const sessions = useLiveQuery(async () => await listSessionMetadata(), [])

  return {
    sessions: sessions ?? [],
  }
}
