import { AppSidebar as BaseAppSidebar } from "@gitinspect/ui/components/app-sidebar";

export function AppSidebar({ showGetPro = true }: { showGetPro?: boolean } = {}) {
  return <BaseAppSidebar showGetPro={showGetPro} />;
}
