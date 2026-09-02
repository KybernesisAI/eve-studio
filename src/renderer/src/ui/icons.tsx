import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

/** Build a stroke-based, currentColor icon from its inner SVG nodes. */
function make(nodes: ReactNode): (props: IconProps) => JSX.Element {
  return function Icon({ className = "h-4 w-4" }: IconProps): JSX.Element {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {nodes}
      </svg>
    );
  };
}

export const IconBot = make(
  <>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4M8 4h8" />
    <path d="M9 14h.01M15 14h.01" />
  </>,
);
export const IconChat = make(
  <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z" />,
);
export const IconLayers = make(
  <>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5M3 16.5l9 5 9-5" opacity="0.6" />
  </>,
);
export const IconBrain = make(
  <>
    <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3 2.5 2.5 0 0 0 3-2.5V6.5A2.5 2.5 0 0 0 9 4Z" />
    <path
      d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3 2.5 2.5 0 0 1-3-2.5"
      opacity="0.6"
    />
  </>,
);
export const IconPlug = make(
  <>
    <path d="M9 2v6M15 2v6" />
    <path d="M7 8h10v3a5 5 0 0 1-10 0V8Z" />
    <path d="M12 16v6" />
  </>,
);
export const IconCalendar = make(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </>,
);
export const IconWand = make(
  <>
    <path d="m5 19 10-10" />
    <path d="M14 4.5 15 6l1.5.5L15 7l-1 1.5L13 7l-1.5-.5L13 6l1-1.5Z" />
    <path d="M19 13.5 20 15l1.5.5L20 16l-1 1.5-1-1.5-1.5-.5 1.5-.5 1-1.5Z" />
  </>,
);
export const IconFile = make(
  <>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M9 13h6M9 17h4" opacity="0.6" />
  </>,
);
export const IconRocket = make(
  <>
    <path d="M4.5 16.5c-1.5 1-2 5-2 5s4-.5 5-2c.5-.8.5-2-.5-3s-2.2-.5-2.5 0Z" />
    <path d="M12 15 9 12a11 11 0 0 1 6-8c2.5-1.5 5-1 5-1s.5 2.5-1 5a11 11 0 0 1-8 6Z" />
    <path d="M9 12H4l3-4M12 15v5l4-3" opacity="0.6" />
  </>,
);
export const IconCheck = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>,
);
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 6.2 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3.3 6.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3.3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </>,
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconArrowUp = make(<path d="M12 20V5M5 12l7-7 7 7" />);
export const IconDownload = make(<path d="M12 3v12M7 11l5 5 5-5M5 21h14" />);
export const IconArchive = make(
  <>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
    <path d="M10 12h4" />
  </>,
);
export const IconInbox = make(
  <>
    <path d="M3 12h5l1.5 3h5L16 12h5" />
    <path d="M5 6h14l2 6v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-6Z" />
  </>,
);
export const IconPlay = make(<path d="M7 4.5v15l13-7.5-13-7.5Z" />);
export const IconStop = make(
  <rect x="6" y="6" width="12" height="12" rx="2" />,
);
export const IconTrash = make(
  <>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </>,
);
export const IconRefresh = make(
  <>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </>,
);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const IconExternal = make(
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </>,
);
export const IconChevronRight = make(<path d="m9 6 6 6-6 6" />);
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconWrench = make(
  <path d="M14.5 5.5a4 4 0 0 0-5 5L3 17v4h4l6.5-6.5a4 4 0 0 0 5-5l-2.6 2.6-2.4-.4-.4-2.4 2.4-2.4Z" />,
);
export const IconTerminal = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </>,
);
export const IconBolt = make(<path d="M13 2 4 14h7l-2 8 9-12h-7l2-8Z" />);
export const IconFolder = make(
  <path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />,
);
export const IconServer = make(
  <>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </>,
);

export const IconCpu = make(
  <>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" opacity="0.6" />
  </>,
);
export const IconRadio = make(
  <>
    <circle cx="12" cy="12" r="2" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
    <path
      d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2"
      opacity="0.55"
    />
  </>,
);
export const IconBox = make(
  <>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" opacity="0.55" />
  </>,
);
export const IconWebhook = make(
  <>
    <path d="M9 8a3 3 0 1 1 4 2.8l2.2 3.7" />
    <path d="M15 16a3 3 0 1 1-3-3" opacity="0.9" />
    <path d="M6.5 13.5a3 3 0 1 0 3.5 4.5H14" opacity="0.55" />
  </>,
);
export const IconKey = make(
  <>
    <circle cx="8" cy="8" r="4" />
    <path d="m11 11 8 8M16 16l2-2M19 19l1.5-1.5" />
  </>,
);

/** The Eve wordmark mark, three stacked bars (☰), as in the eve CLI banner. */
export function IconEve({
  className = "h-4 w-4",
}: {
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="2.6" rx="1.3" />
      <rect x="3" y="10.7" width="18" height="2.6" rx="1.3" />
      <rect x="3" y="16.4" width="18" height="2.6" rx="1.3" />
    </svg>
  );
}
