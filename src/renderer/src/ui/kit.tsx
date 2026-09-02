import type { AgentRunStatus } from "@shared/ipc";
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useEffect,
  useState,
} from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ *
 * Design language, "Deck"
 *   · Space Mono for all metadata / labels (uppercase, tracked)
 *   · Geist for content and interactive labels
 *   · Layered flat surfaces + hairlines, not boxed cards
 *   · Monochrome; color reserved for live status only
 * ------------------------------------------------------------------ */

/** Monospace uppercase eyebrow, the signature label of the app. */
export function Kicker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cx(
        "font-spacemono text-[10px] uppercase leading-none tracking-[0.18em] text-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

// --- Button ---
type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BTN_BASE =
  "no-drag inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-text text-white hover:bg-text/85",
  // "secondary" kept for back-compat but rendered as a refined outline.
  secondary:
    "border border-border bg-transparent text-text hover:border-border-strong hover:bg-black/[0.03]",
  outline:
    "border border-border bg-transparent text-text hover:border-border-strong hover:bg-black/[0.03]",
  ghost: "text-muted hover:bg-black/[0.05] hover:text-text",
  danger: "text-danger hover:bg-danger/10",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12.5px]",
  md: "h-8 px-3 text-[13px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}): JSX.Element {
  return (
    <button
      type="button"
      className={cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      className={cx(
        "no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-black/[0.05] hover:text-text disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// --- Badge (mono pill) ---
type Tone =
  "default" | "accent" | "success" | "warn" | "danger" | "info" | "violet";
const TONE: Record<Tone, string> = {
  default: "bg-black/[0.045] text-muted",
  accent: "bg-accent/10 text-accent",
  success: "bg-success/12 text-success",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/10 text-info",
  violet: "bg-violet/12 text-violet",
};

export function Badge({
  tone = "default",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-spacemono text-[10px] uppercase leading-none tracking-wider",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// --- StatusDot ---
const DOT: Record<AgentRunStatus, string> = {
  running: "bg-success",
  starting: "bg-warn",
  stopped: "bg-faint/60",
  error: "bg-danger",
};

export function StatusDot({
  status,
  className,
}: {
  status: AgentRunStatus;
  className?: string;
}): JSX.Element {
  return (
    <span className={cx("relative inline-flex", className)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", DOT[status])} />
      {status === "running" ? (
        <span className="absolute inset-0 h-1.5 w-1.5 animate-pulse-ring rounded-full" />
      ) : null}
      {status === "starting" ? (
        <span className="absolute inset-0 h-1.5 w-1.5 animate-ping rounded-full bg-warn/60" />
      ) : null}
    </span>
  );
}

// --- Surface / Card (flat, hairline; opt-in elevation) ---
export function Card({
  className,
  children,
  raised,
}: {
  className?: string;
  children: ReactNode;
  raised?: boolean;
}): JSX.Element {
  return (
    <div
      className={cx(
        "rounded-xl border border-border bg-panel",
        raised && "shadow-pop",
        className,
      )}
    >
      {children}
    </div>
  );
}

// --- Inputs ---
export function Input(
  props: InputHTMLAttributes<HTMLInputElement>,
): JSX.Element {
  return (
    <input
      {...props}
      className={cx(
        "no-drag w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text outline-none transition-colors placeholder:text-faint focus:border-border-strong",
        props.className,
      )}
    />
  );
}

export function Textarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
): JSX.Element {
  return (
    <textarea
      {...props}
      className={cx(
        "no-drag w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-relaxed text-text outline-none transition-colors placeholder:text-faint focus:border-border-strong",
        props.className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-spacemono text-[10px] uppercase tracking-[0.14em] text-faint">
          {label}
        </span>
        {hint ? <span className="text-2xs text-faint">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

// --- Spinner (braille "columns" loader) ---
// Procedurally generated braille frames: fill each of 6 columns bottom-up, then
// flash full/empty. Adapted from gunnargray-dev/unicode-animations.
const BRAILLE_FRAMES: string[] = (() => {
  const DOT_MAP = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
  ];
  const W = 6;
  const H = 4;
  const grid = (): boolean[][] =>
    Array.from({ length: H }, () => Array<boolean>(W).fill(false));
  const toBraille = (g: boolean[][]): string => {
    let result = "";
    for (let c = 0; c < Math.ceil(W / 2); c++) {
      let code = 0x2800;
      for (let r = 0; r < H; r++) {
        for (let d = 0; d < 2; d++) {
          const col = c * 2 + d;
          if (g[r][col]) {
            code |= DOT_MAP[r][d];
          }
        }
      }
      result += String.fromCodePoint(code);
    }
    return result;
  };
  const frames: string[] = [];
  for (let col = 0; col < W; col++) {
    for (let fillTo = H - 1; fillTo >= 0; fillTo--) {
      const g = grid();
      for (let pc = 0; pc < col; pc++) {
        for (let r = 0; r < H; r++) {
          g[r][pc] = true;
        }
      }
      for (let r = fillTo; r < H; r++) {
        g[r][col] = true;
      }
      frames.push(toBraille(g));
    }
  }
  const full = grid();
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      full[r][c] = true;
    }
  }
  frames.push(toBraille(full));
  frames.push(toBraille(grid()));
  return frames;
})();

export function Spinner({ className }: { className?: string }): JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const iv = setInterval(
      () => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length),
      60,
    );
    return () => clearInterval(iv);
  }, []);
  return (
    <span
      className={cx(
        "inline-block select-none font-spacemono leading-none tracking-[1px]",
        className,
      )}
      aria-hidden="true"
    >
      {BRAILLE_FRAMES[frame]}
    </span>
  );
}

// --- EmptyState (editorial) ---
export function EmptyState({
  icon,
  kicker,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  kicker?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      {icon ? <div className="mb-4 text-border-strong">{icon}</div> : null}
      {kicker ? <Kicker className="mb-2.5">{kicker}</Kicker> : null}
      <div className="text-[19px] font-semibold tracking-tight text-text">
        {title}
      </div>
      {children ? (
        <div className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

// --- ViewHeader (the standard surface header) ---
export function ViewHeader({
  kicker,
  title,
  count,
  right,
}: {
  kicker?: string;
  title: string;
  count?: number;
  right?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3.5">
      <div className="min-w-0">
        {kicker ? <Kicker className="mb-1.5">{kicker}</Kicker> : null}
        <div className="flex items-baseline gap-2">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-text">
            {title}
          </h2>
          {typeof count === "number" ? (
            <span className="font-mono text-2xs text-faint">{count}</span>
          ) : null}
        </div>
      </div>
      {right ? (
        <div className="flex shrink-0 items-center gap-1.5">{right}</div>
      ) : null}
    </div>
  );
}

// --- ListRow (replaces stacked cards) ---
export function ListRow({
  icon,
  title,
  badge,
  desc,
  meta,
  right,
  onClick,
}: {
  icon?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  desc?: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}): JSX.Element {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cx(
        "group flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
        onClick && "hover:bg-black/[0.02]",
      )}
    >
      {icon ? (
        <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-faint">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[13px] text-text">
            {title}
          </span>
          {badge}
        </div>
        {desc ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{desc}</p>
        ) : null}
        {meta ? <div className="mt-1.5">{meta}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </Tag>
  );
}

/** Container that lays ListRows out as a clean divided list, not boxes. */
export function List({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cx("divide-y divide-border/70", className)}>{children}</div>
  );
}

// --- Tabs (top, underline) ---
export interface TabItem {
  id: string;
  label: string;
  icon?: (p: { className?: string }) => JSX.Element;
  count?: number;
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div className="no-drag no-scrollbar flex items-stretch gap-0.5 overflow-x-auto">
      {items.map((t) => {
        const on = t.id === active;
        const Ico = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cx(
              "relative flex h-11 shrink-0 items-center gap-2 px-3 text-[13px] font-medium transition-colors",
              on ? "text-text" : "text-faint hover:text-muted",
            )}
          >
            {Ico ? (
              <Ico
                className={cx("h-4 w-4", on ? "opacity-100" : "opacity-60")}
              />
            ) : null}
            {t.label}
            {typeof t.count === "number" ? (
              <span className="font-mono text-2xs text-faint">{t.count}</span>
            ) : null}
            {on ? (
              <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-text" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// --- Modal ---
export function Modal({
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
      />
      <div
        className={cx(
          "relative flex max-h-[88vh] w-full animate-slide-up flex-col rounded-2xl border border-border bg-elevated shadow-pop",
          width,
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-4">
          <div>
            <Kicker className="mb-1">Eve Studio</Kicker>
            <span className="text-[15px] font-semibold tracking-tight text-text">
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-faint hover:bg-black/[0.05] hover:text-text"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// --- SubNav (segmented sub-tabs inside a grouped tab) ---
export interface SubNavItem {
  id: string;
  label: string;
  count?: number;
}

export function SubNav({
  items,
  active,
  onChange,
}: {
  items: SubNavItem[];
  active: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div className="no-scrollbar flex shrink-0 items-center gap-5 overflow-x-auto border-b border-border px-6">
      {items.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cx(
              "relative flex h-10 shrink-0 items-center gap-1.5 text-[13px] font-medium transition-colors",
              on ? "text-text" : "text-faint hover:text-muted",
            )}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span className="font-mono text-2xs text-faint">{t.count}</span>
            ) : null}
            {on ? (
              <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-text" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// --- PanelHeader (kept for back-compat; mono-styled) ---
export function PanelHeader({
  title,
  count,
  right,
}: {
  title: string;
  count?: number;
  right?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-spacemono text-[11px] uppercase tracking-[0.14em] text-muted">
          {title}
        </span>
        {typeof count === "number" ? (
          <span className="font-mono text-2xs text-faint">{count}</span>
        ) : null}
      </div>
      {right}
    </div>
  );
}
