import { pipe } from "effect/Function";
import { useAtomValue } from "@effect/atom-react";
import {
  questionRequestAnswerInput,
  questionRequestDisplay,
  questionRequestDraftProblem,
  questionRequestFailureMessage,
  type QuestionRequestDraft,
  type QuestionRequestItem,
  setQuestionRequestCustom,
  toggleQuestionRequestChoice,
} from "@moonfold/client-runtime/question-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";
import type {
  AssetResource,
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  QuestionRequestOption,
  QuestionRequestQuestion,
  ScopedThreadRef,
} from "@moonfold/contracts";
import { CheckIcon, ImageIcon, MessageCircleQuestionIcon, MinusIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { cn } from "~/lib/utils";

import { useAssetUrls } from "../../assets/assetUrls";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { workspaceAssetResource } from "../files/filePreviewMode";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio-group";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { WorkLogRow } from "./WorkLog";

/** Where option pictures load from, and how one opens larger. */
interface QuestionImageContext {
  readonly threadRef: ScopedThreadRef | null;
  readonly workspaceRoot: string | undefined;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
}

/**
 * A question an agent asked while it waits in its run. Answered and dismissed
 * cards collapse to one line.
 */
export function QuestionRequestCard(
  props: {
    readonly environmentId: EnvironmentId;
    readonly item: QuestionRequestItem;
    readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
  } & QuestionImageContext,
) {
  const { item } = props;
  const display = questionRequestDisplay(item, props.visibility);
  if (display.kind !== "pending") {
    const Icon =
      display.kind === "answered"
        ? CheckIcon
        : display.kind === "ended"
          ? MinusIcon
          : MessageCircleQuestionIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={item.title ? `${item.title} · ${display.label}` : display.label}
      />
    );
  }
  return <PendingQuestionRequestForm {...props} />;
}

function PendingQuestionRequestForm(
  props: {
    readonly environmentId: EnvironmentId;
    readonly item: QuestionRequestItem;
  } & QuestionImageContext,
) {
  const { item } = props;
  const titleId = useId();
  const errorId = useId();
  const answer = useAtomCommand(serverEnvironment.answerQuestionRequest, {
    label: "answer question request",
    reportFailure: false,
  });
  const canAnswer = useAtomValue(
    serverEnvironment.answerQuestionRequest.permissionAtom(props.environmentId),
  );
  const [draft, setDraft] = useState<QuestionRequestDraft>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter and click can both submit before a render.
  const inFlight = useRef(false);
  const problem = questionRequestDraftProblem(item, draft);

  const send = async (reply: Parameters<typeof questionRequestAnswerInput>[1]) => {
    const input = questionRequestAnswerInput(item, reply);
    if (input === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await answer({ environmentId: props.environmentId, input }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), questionRequestFailureMessage, setError);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send({ type: "submit", draft });
  };
  const disabled = submitting || !canAnswer;

  return (
    <form
      data-v2-item-type={item.type}
      aria-labelledby={titleId}
      aria-describedby={error === null ? undefined : errorId}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border/60 bg-card p-4"
      onSubmit={onSubmit}
      autoComplete="off"
    >
      <p id={titleId} className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <MessageCircleQuestionIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 wrap-anywhere">{item.title ?? "The agent has a question"}</span>
      </p>
      {item.questions.map((question) => (
        <QuestionField
          key={question.id}
          environmentId={props.environmentId}
          item={item}
          question={question}
          draft={draft}
          disabled={disabled}
          images={props}
          onDraftChange={(next) => {
            setDraft(next);
            setError(null);
          }}
        />
      ))}
      {error !== null ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {canAnswer ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            disabled={submitting}
            onClick={() => void send({ type: "dismiss" })}
          >
            Dismiss
          </Button>
          <Button type="submit" size="xs" disabled={submitting || problem !== null}>
            Submit
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Only a session that can run agents here can answer this.
        </p>
      )}
    </form>
  );
}

function QuestionField(props: {
  readonly environmentId: EnvironmentId;
  readonly item: QuestionRequestItem;
  readonly question: QuestionRequestQuestion;
  readonly draft: QuestionRequestDraft;
  readonly disabled: boolean;
  readonly images: QuestionImageContext;
  readonly onDraftChange: (draft: QuestionRequestDraft) => void;
}) {
  const { question, draft } = props;
  const legendId = useId();
  const current = Object.hasOwn(draft, question.id) ? draft[question.id] : undefined;
  const selected = current?.selected ?? [];
  const pictures = question.options.some((option) => (option.images?.length ?? 0) > 0);
  const toggle = (label: string) =>
    props.onDraftChange(toggleQuestionRequestChoice(draft, question, label));
  const options = question.options.map((option) => (
    <OptionRow
      key={option.label}
      environmentId={props.environmentId}
      item={props.item}
      option={option}
      multiSelect={question.multiSelect === true}
      checked={selected.includes(option.label)}
      disabled={props.disabled}
      pictures={pictures}
      images={props.images}
      onToggle={() => toggle(option.label)}
    />
  ));
  const layout = pictures ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "flex flex-col gap-1.5";

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-labelledby={legendId}>
      <div id={legendId} className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground uppercase">
          {question.header}
        </span>
        <span className="text-sm wrap-anywhere text-foreground">{question.question}</span>
      </div>
      {question.multiSelect === true ? (
        <div className={layout}>{options}</div>
      ) : (
        <RadioGroup
          aria-labelledby={legendId}
          value={selected[0] ?? null}
          disabled={props.disabled}
          onValueChange={(next) => {
            if (typeof next === "string" && !selected.includes(next)) toggle(next);
          }}
        >
          <div className={layout}>{options}</div>
        </RadioGroup>
      )}
      {question.allowCustomAnswer === true ? (
        <Input
          size="sm"
          aria-label={`Other answer for ${question.header}`}
          placeholder="Other…"
          value={current?.custom ?? ""}
          disabled={props.disabled}
          onChange={(event) =>
            props.onDraftChange(
              setQuestionRequestCustom(draft, question, event.currentTarget.value),
            )
          }
        />
      ) : null}
    </fieldset>
  );
}

function OptionRow(props: {
  readonly environmentId: EnvironmentId;
  readonly item: QuestionRequestItem;
  readonly option: QuestionRequestOption;
  readonly multiSelect: boolean;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly pictures: boolean;
  readonly images: QuestionImageContext;
  readonly onToggle: () => void;
}) {
  const { option } = props;
  const control = props.multiSelect ? (
    <Checkbox checked={props.checked} disabled={props.disabled} onCheckedChange={props.onToggle} />
  ) : (
    <Radio value={option.label} />
  );
  const label = (
    <label className="flex min-w-0 cursor-pointer items-start gap-2.5 px-3 py-2 text-sm">
      <span className="mt-0.5 flex shrink-0">{control}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium wrap-anywhere">{option.label}</span>
        {option.description ? (
          <span className="text-xs wrap-anywhere text-muted-foreground">{option.description}</span>
        ) : null}
      </span>
    </label>
  );
  return (
    <div
      data-checked={props.checked || undefined}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border/70 data-checked:border-primary/60 data-checked:bg-primary/4"
    >
      {props.pictures ? (
        <OptionImages
          environmentId={props.environmentId}
          item={props.item}
          option={option}
          context={props.images}
        />
      ) : null}
      {label}
    </div>
  );
}

/** The option's pictures: the first one large, the rest in a row beneath. */
function OptionImages(props: {
  readonly environmentId: EnvironmentId;
  readonly item: QuestionRequestItem;
  readonly option: QuestionRequestOption;
  readonly context: QuestionImageContext;
}) {
  const paths = props.option.images ?? [];
  const { threadRef, workspaceRoot } = props.context;
  const resources: ReadonlyArray<AssetResource> = paths.map((path) =>
    threadRef !== null && workspaceRoot !== undefined
      ? workspaceAssetResource({
          kind: "workspace-file",
          threadRef,
          draft: false,
          workspaceRoot,
          absolutePath: path,
        })
      : { _tag: "workspace-file", threadId: props.item.threadId, path },
  );
  const urls = useAssetUrls(props.environmentId, resources);
  if (paths.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center bg-muted/40">
        <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
      </div>
    );
  }
  const expand = (index: number) => {
    const images = paths.flatMap((path, at) => {
      const src = urls[at];
      return src ? [{ src, name: imageName(props.option.label, path), at }] : [];
    });
    const start = images.findIndex((image) => image.at === index);
    if (start < 0) return;
    props.context.onImageExpand({
      images: images.map(({ src, name }) => ({ src, name })),
      index: start,
    });
  };
  const rest = paths.slice(1);
  return (
    <div className="flex flex-col gap-1 p-1 pb-0">
      <Thumbnail
        src={urls[0] ?? null}
        label={`Open ${props.option.label} picture larger`}
        large
        onOpen={() => expand(0)}
      />

      {rest.length > 0 ? (
        <div className="grid grid-cols-3 gap-1">
          {rest.map((path, offset) => (
            <Thumbnail
              key={path}
              src={urls[offset + 1] ?? null}
              label={`Open ${props.option.label} picture ${offset + 2} larger`}
              large={false}
              onOpen={() => expand(offset + 1)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Thumbnail(props: {
  readonly src: string | null;
  readonly label: string;
  readonly large: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.src === null}
      onClick={props.onOpen}
      className={cn(
        "flex w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-md bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default",
        props.large ? "aspect-video" : "aspect-square",
      )}
    >
      {props.src === null ? (
        <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
      ) : (
        <img src={props.src} alt="" loading="lazy" className="size-full object-cover" />
      )}
    </button>
  );
}

const imageName = (label: string, path: string) => {
  const file = path.split(/[\\/]/).at(-1);
  return file ? `${label} · ${file}` : label;
};
