import * as React from "react";
import { toast } from "sonner";
import { PaperclipIcon } from "lucide-react";
import { ChatModelSelector } from "./chat-model-selector";
import type { ChatStatus } from "ai";
import type { PromptInputMessage } from "@gitaura/ui/components/ai-elements/prompt-input";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  SUPPORTED_ATTACHMENT_ACCEPT,
  SUPPORTED_ATTACHMENT_PICKER_TYPES,
  type UserTurnInput,
} from "@gitaura/pi/agent/user-turn-input";
import type { ProviderGroupId, ThinkingLevel } from "@gitaura/pi/types/models";
import { getModelForGroup } from "@gitaura/pi/models/catalog";
import {
  clampThinkingLevel,
  formatThinkingLevelLabel,
  getAvailableThinkingLevels,
} from "@gitaura/pi/agent/thinking-levels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gitaura/ui/components/select";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@gitaura/ui/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputButton,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@gitaura/ui/components/ai-elements/prompt-input";

function ChatComposerInner(props: {
  composerDisabled?: boolean;
  disabledReason?: string;
  isStreaming: boolean;
  model: string;
  onAbort: () => void;
  onSelectModel: (providerGroup: ProviderGroupId, modelId: string) => Promise<void> | void;
  onSend: (input: UserTurnInput) => Promise<void> | void;
  onThinkingLevelChange: (level: ThinkingLevel) => Promise<void> | void;
  placeholder?: string;
  providerGroup: ProviderGroupId;
  thinkingLevel: ThinkingLevel;
  utilityActions?: React.ReactNode;
}) {
  const { attachments, textInput } = usePromptInputController();
  const text = textInput.value;
  const hasAttachments = attachments.files.length > 0;
  const locked = props.composerDisabled === true;

  const handleAddAttachments = React.useCallback(() => {
    attachments.openFileDialog();
  }, [attachments]);

  const handleSubmit = React.useCallback(
    async (message: PromptInputMessage) => {
      if (locked || props.isStreaming) {
        return;
      }

      const input: UserTurnInput = {
        files: message.files.map((file) => ({
          filename: file.filename,
          mediaType: file.mediaType,
          size: file.size,
          url: file.url,
        })),
        text: message.text.trim(),
      };

      if (!input.text && input.files?.length === 0) {
        return;
      }

      await props.onSend(input);
    },
    [locked, props.isStreaming, props.onSend],
  );

  const submitStatus: ChatStatus = props.isStreaming ? "streaming" : "ready";

  const currentModel = getModelForGroup(props.providerGroup, props.model);
  const thinkingLevels = getAvailableThinkingLevels(currentModel);
  const supportsThinking = thinkingLevels.some((level) => level !== "off");
  const selectedThinkingLevel = clampThinkingLevel(props.thinkingLevel, currentModel);
  const controlsDisabled = locked || props.isStreaming;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <PromptInput
        accept={SUPPORTED_ATTACHMENT_ACCEPT}
        filePickerTypes={SUPPORTED_ATTACHMENT_PICKER_TYPES}
        maxFileSize={MAX_ATTACHMENT_SIZE_BYTES}
        multiple
        onError={(error) => toast.error(error.message)}
        onSubmit={handleSubmit}
      >
        <PromptInputHeader>
          <PromptInputAttachmentsRow />
        </PromptInputHeader>

        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-[4.5rem] text-sm font-medium leading-6 text-foreground placeholder:text-muted-foreground md:text-base"
            disabled={locked}
            placeholder={
              locked
                ? (props.disabledReason ?? "Select a repository to get started")
                : (props.placeholder ?? "What would you like to know?")
            }
          />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputButton
              aria-label="Add attachments"
              disabled={locked}
              onClick={handleAddAttachments}
              tooltip={{
                content: "Attach supported images and documents to this message.",
              }}
            >
              <PaperclipIcon className="size-4" />
            </PromptInputButton>

            <ChatModelSelector
              disabled={controlsDisabled}
              model={props.model}
              onSelect={props.onSelectModel}
              providerGroup={props.providerGroup}
            />

            {supportsThinking ? (
              <Select
                disabled={controlsDisabled}
                onValueChange={(value) => {
                  void props.onThinkingLevelChange(value as ThinkingLevel);
                }}
                value={selectedThinkingLevel}
              >
                <SelectTrigger aria-label="Thinking mode" className="min-w-24" size="sm">
                  <SelectValue placeholder="Thinking" />
                </SelectTrigger>
                <SelectContent>
                  {thinkingLevels.map((level) => (
                    <SelectItem key={level} value={level}>
                      {formatThinkingLevelLabel(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </PromptInputTools>

          {props.utilityActions ? (
            <div className="ml-auto shrink-0">{props.utilityActions}</div>
          ) : null}

          <PromptInputSubmit
            disabled={locked || (!text.trim() && !hasAttachments && !props.isStreaming)}
            onStop={props.onAbort}
            status={submitStatus}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function PromptInputAttachmentsRow() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((file) => (
        <Attachment data={file} key={file.id} onRemove={() => attachments.remove(file.id)}>
          <AttachmentPreview />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  );
}

export function ChatComposer(props: {
  composerDisabled?: boolean;
  disabledReason?: string;
  initialInput?: string;
  isStreaming: boolean;
  model: string;
  onAbort: () => void;
  onSelectModel: (providerGroup: ProviderGroupId, modelId: string) => Promise<void> | void;
  onSend: (input: UserTurnInput) => Promise<void> | void;
  onThinkingLevelChange: (level: ThinkingLevel) => Promise<void> | void;
  placeholder?: string;
  providerGroup: ProviderGroupId;
  thinkingLevel: ThinkingLevel;
  utilityActions?: React.ReactNode;
}) {
  return (
    <PromptInputProvider initialInput={props.initialInput} key={props.initialInput ?? ""}>
      <ChatComposerInner {...props} />
    </PromptInputProvider>
  );
}
