import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, Plus } from "lucide-react";
import { db } from "@webaura/db";
import type { ProviderGroupId } from "@webaura/pi/types/models";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
  ModelSelectorSeparator,
} from "@webaura/ui/components/ai-elements/model-selector";
import { PromptInputButton } from "@webaura/ui/components/ai-elements/prompt-input";
import {
  getConnectedProviders,
  getDefaultModelForGroup,
  getModelForGroup,
  getModelsForGroup,
  getProviderGroupMetadata,
  getVisibleProviderGroups,
} from "@webaura/pi/models/catalog";
import { cn } from "@webaura/ui/lib/utils";

export function ChatModelSelector(props: {
  disabled?: boolean;
  model: string;
  onSelect: (providerGroup: ProviderGroupId, modelId: string) => void;
  providerGroup: ProviderGroupId;
}) {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const providerKeysResult = useLiveQuery(() => db.providerKeys.toArray(), []);
  const providerKeys = Array.isArray(providerKeysResult) ? providerKeysResult : [];
  const connectedProviders = getConnectedProviders(providerKeys);
  const showAddProviderCta = connectedProviders.length === 0;
  const providerGroups = getVisibleProviderGroups(connectedProviders);
  const activeProviderGroup = providerGroups.includes(props.providerGroup)
    ? props.providerGroup
    : (providerGroups[0] ?? props.providerGroup);
  const activeModelId =
    activeProviderGroup === props.providerGroup
      ? props.model
      : getDefaultModelForGroup(activeProviderGroup).id;
  const selectedModel = getModelForGroup(activeProviderGroup, activeModelId);

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton disabled={props.disabled} type="button">
          <ModelSelectorLogo className="size-3.5 shrink-0" provider={selectedModel.provider} />
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </PromptInputButton>
      </ModelSelectorTrigger>

      <ModelSelectorContent className="max-h-[min(420px,70vh)]">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          {providerGroups.map((groupId) => (
            <ModelSelectorGroup heading={getProviderGroupMetadata(groupId).label} key={groupId}>
              {getModelsForGroup(groupId).map((model) => {
                const value = `${groupId}:${model.id}`;
                const isSelected = groupId === activeProviderGroup && model.id === activeModelId;

                return (
                  <ModelSelectorItem
                    className={cn("gap-2")}
                    key={value}
                    onSelect={() => {
                      props.onSelect(groupId, model.id);
                      setOpen(false);
                    }}
                    value={value}
                  >
                    <ModelSelectorLogo className="size-3.5 shrink-0" provider={model.provider} />
                    <ModelSelectorName>{model.name}</ModelSelectorName>
                    <CheckIcon
                      className={cn(
                        "ml-auto size-4 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
          {showAddProviderCta ? (
            <>
              <ModelSelectorSeparator />
              <ModelSelectorGroup heading="Providers">
                <ModelSelectorItem
                  className="gap-2"
                  onSelect={() => {
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        settings: "providers",
                      }),
                      to: ".",
                    });
                    setOpen(false);
                  }}
                  value="__add_provider__"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="text-sm">Add AI provider</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Add an API key or import OAuth credentials to start chatting.
                    </span>
                  </span>
                </ModelSelectorItem>
              </ModelSelectorGroup>
            </>
          ) : null}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
