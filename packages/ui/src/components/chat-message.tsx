import { AlertCircle, AlertTriangle, ChevronDown, Info } from "lucide-react";
import {
  deriveAssistantView,
  getUserAttachments,
  getUserText,
  isSystemMessage,
  isToolResultMessage,
} from "@webaura/pi/lib/chat-adapter";
import type { DisplayChatMessage } from "@webaura/pi/types/chat";
import {
  Message,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
} from "@webaura/ui/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@webaura/ui/components/ai-elements/reasoning";
import { StatusShimmer } from "@webaura/ui/components/ai-elements/shimmer";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@webaura/ui/components/ai-elements/sources";
import { ToolExecution } from "@webaura/ui/components/tool-execution";
import { ToolResultBubble } from "@webaura/ui/components/tool-result-bubble";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@webaura/ui/components/ai-elements/attachments";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@webaura/ui/components/item";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@webaura/ui/components/collapsible";
import { cn } from "@webaura/ui/lib/utils";

function getAttachmentUrl(
  message: Extract<DisplayChatMessage, { role: "user" }>,
  index: number,
): string {
  const attachment = message.attachments?.[index];

  if (!attachment || attachment.type !== "image" || typeof message.content === "string") {
    return "";
  }

  const part =
    typeof attachment.contentPartIndex === "number"
      ? message.content[attachment.contentPartIndex]
      : undefined;

  if (!part || part.type !== "image") {
    return "";
  }

  return `data:${part.mimeType};base64,${part.data}`;
}

export function ChatMessage(props: {
  followingMessages?: ReadonlyArray<DisplayChatMessage>;
  isStreamingReasoning: boolean;
  message: DisplayChatMessage;
}) {
  const { message } = props;

  if (message.role === "user") {
    const attachments = getUserAttachments(message);
    const text = getUserText(message);

    return (
      <Message from="user">
        <MessageContent>
          {text ? <MessageResponse>{text}</MessageResponse> : null}
          {attachments.length > 0 ? (
            <Attachments className="mt-2" variant="inline">
              {attachments.map((attachment, index) => (
                <Attachment
                  data={{
                    filename: attachment.fileName,
                    id: attachment.id,
                    mediaType: attachment.mediaType,
                    type: "file",
                    url: getAttachmentUrl(message, index),
                  }}
                  key={attachment.id}
                >
                  <AttachmentPreview />
                  <AttachmentInfo />
                </Attachment>
              ))}
            </Attachments>
          ) : null}
        </MessageContent>
      </Message>
    );
  }

  if (isToolResultMessage(message)) {
    return <ToolResultBubble message={message} />;
  }

  if (isSystemMessage(message)) {
    const severity = message.severity;
    const tone =
      severity === "error"
        ? "bg-red-100 text-red-900 dark:bg-red-950/30 dark:text-red-200"
        : severity === "warning"
          ? "bg-amber-100 text-amber-950 dark:bg-amber-950/25 dark:text-amber-100"
          : "bg-muted/40 text-foreground";

    const icon =
      severity === "error" ? (
        <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
      ) : severity === "warning" ? (
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      ) : (
        <Info className="size-4 text-muted-foreground" />
      );

    const showHtmlDetails = Boolean(message.detailsHtml);

    return (
      <div className="flex w-full justify-start py-1">
        <Item
          className={`max-w-full flex-1 flex-wrap items-start gap-2 rounded-lg border border-border text-sm ${tone}`}
          variant="outline"
        >
          <ItemMedia variant="icon">{icon}</ItemMedia>
          <ItemContent>
            <ItemTitle className="line-clamp-none text-[13px] font-medium">
              {message.kind.replace(/_/g, " ")}
            </ItemTitle>
            <ItemDescription className="line-clamp-none text-[13px] text-inherit opacity-90">
              {message.message}
            </ItemDescription>
            {showHtmlDetails ? (
              <Collapsible className="mt-3 overflow-hidden rounded-md border border-border/60 bg-background/70 text-foreground">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted/40">
                  <span>HTML response</span>
                  <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/60 px-3 py-3">
                  <div className="space-y-3">
                    {message.detailsContext ? (
                      <p className="rounded border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                        {message.detailsContext}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Sandboxed preview for inspection only. It won&apos;t satisfy the original
                      challenge request.
                    </p>
                    <iframe
                      className="h-72 w-full rounded border border-border/60 bg-background"
                      sandbox="allow-scripts"
                      srcDoc={message.detailsHtml}
                      title={`HTML response preview ${message.id}`}
                    />
                    <pre
                      className={cn(
                        "max-h-72 overflow-auto rounded border border-border/60 bg-muted/40 p-3 font-mono text-[11px] whitespace-pre-wrap break-all",
                        "selection:bg-primary/20",
                      )}
                    >
                      {message.detailsHtml}
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </ItemContent>
        </Item>
      </div>
    );
  }

  const view = deriveAssistantView(message, props.followingMessages);
  const isStreamingAssistant = "status" in message && message.status === "streaming";
  const showStreamingPlaceholder =
    isStreamingAssistant &&
    view.text.length === 0 &&
    view.reasoning.length === 0 &&
    view.toolExecutions.length === 0;

  return (
    <Message from="assistant">
      <div className="flex w-full flex-col gap-2">
        {showStreamingPlaceholder ? (
          <MessageContent>
            <StatusShimmer duration={1.5}>Assistant is streaming...</StatusShimmer>
          </MessageContent>
        ) : null}

        {view.sources.length > 0 ? (
          <Sources>
            <SourcesTrigger count={view.sources.length} />
            <SourcesContent>
              {view.sources.map((source) => (
                <Source href={source.href} key={source.href} title={source.title}>
                  <span className="font-medium">{source.title}</span>
                </Source>
              ))}
            </SourcesContent>
          </Sources>
        ) : null}

        {view.reasoning ? (
          <Reasoning isStreaming={props.isStreamingReasoning}>
            <ReasoningTrigger />
            <ReasoningContent>{view.reasoning}</ReasoningContent>
          </Reasoning>
        ) : null}

        {view.text ? (
          <MessageBranch>
            <MessageBranchContent>
              {view.versions.map((versionText, index) => (
                <MessageContent key={`${message.id}-v${String(index)}`}>
                  <MessageResponse>{versionText}</MessageResponse>
                </MessageContent>
              ))}
            </MessageBranchContent>
            <MessageBranchSelector>
              <MessageBranchPrevious />
              <MessageBranchPage />
              <MessageBranchNext />
            </MessageBranchSelector>
          </MessageBranch>
        ) : null}

        {view.toolExecutions.map(({ toolCall, toolResult }) => (
          <ToolExecution key={toolCall.id} toolCall={toolCall} toolResult={toolResult} />
        ))}
      </div>
    </Message>
  );
}
