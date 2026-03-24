import { afterAll } from "vitest"
import { db } from "@/db/schema"

afterAll(() => {
  db.close()
})
