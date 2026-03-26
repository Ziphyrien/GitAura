import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"

export function renderWithProviders(ui: ReactElement) {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>{ui}</TooltipProvider>
    </ThemeProvider>
  )
}
