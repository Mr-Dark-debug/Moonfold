import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@moonfold/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";
import { MessageCircleQuestionIcon } from "lucide-react";
import { useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface SideExchange {
  readonly id: number;
  readonly question: string;
  readonly answer: string | null;
  readonly error: string | null;
}

/**
 * Ask on the side: a quick question about this thread, answered by the thread's own model from
 * its conversation. Answers stay in this popover; nothing joins the thread and a running turn
 * carries on.
 */
export function SideQuestionPopover(props: { readonly threadRef: ScopedThreadRef }) {
  const canOperate = useEnvironmentScope(
    props.threadRef.environmentId,
    AuthOrchestrationOperateScope,
  );
  const askSideQuestion = useAtomCommand(serverEnvironment.askThreadSideQuestion, {
    reportFailure: false,
  });
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<ReadonlyArray<SideExchange>>([]);
  const [pending, setPending] = useState(false);
  const nextExchangeId = useRef(0);
  if (!canOperate) return null;

  const ask = async () => {
    const question = draft.trim();
    if (question.length === 0 || pending) return;
    setDraft("");
    setPending(true);
    setExchanges((current) => [
      ...current,
      { id: nextExchangeId.current++, question, answer: null, error: null },
    ]);
    const result = await askSideQuestion({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, question },
    });
    setPending(false);
    const settle = (patch: Pick<SideExchange, "answer" | "error">) =>
      setExchanges((current) =>
        current.map((exchange, index) =>
          index === current.length - 1 ? { ...exchange, ...patch } : exchange,
        ),
      );
    if (result._tag === "Success") return settle({ answer: result.value.answer, error: null });
    if (isAtomCommandInterrupted(result)) return settle({ answer: null, error: "Cancelled." });
    const error = squashAtomCommandFailure(result);
    settle({
      answer: null,
      error: error instanceof Error ? error.message : "No answer came back.",
    });
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Ask on the side" />
              }
            />
          }
        >
          <MessageCircleQuestionIcon aria-hidden className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Ask on the side</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" side="bottom" className="w-[min(28rem,calc(100vw-2rem))]">
        <div className="flex max-h-[min(32rem,70vh)] flex-col gap-3">
          <div>
            <PopoverTitle>Ask on the side</PopoverTitle>
            <p className="text-xs text-muted-foreground">
              The thread's model answers from the conversation. Nothing is added to the thread.
            </p>
          </div>
          {/* Mounted while empty so answers that arrive later are announced. */}
          <div
            role="log"
            aria-live="polite"
            className={
              exchanges.length > 0 ? "min-h-0 flex-1 space-y-3 overflow-y-auto" : "sr-only"
            }
          >
            {exchanges.map((exchange) => (
              <div key={exchange.id} className="space-y-1.5">
                <p className="text-sm font-medium">{exchange.question}</p>
                {exchange.answer !== null ? (
                  <div className="text-sm">
                    <ChatMarkdown
                      text={exchange.answer}
                      cwd={undefined}
                      threadRef={props.threadRef}
                    />
                  </div>
                ) : exchange.error !== null ? (
                  <p className="text-sm text-destructive-foreground">{exchange.error}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Thinking…</p>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Question about this thread"
              placeholder="What did the agent change in the parser?"
              value={draft}
              rows={2}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void ask();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={pending || draft.trim().length === 0}
              onClick={() => void ask()}
            >
              Ask
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
