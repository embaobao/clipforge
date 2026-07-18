import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import logo from "../../../../assets/brand/clipforge-logo-horizontal.png";
import appIcon from "../../../../assets/brand/clipforge-app-icon-light-source.png";
import agentIcon from "../../../../assets/brand/icons/512/agent-access.png";
import copyIcon from "../../../../assets/brand/icons/512/copy.png";
import searchIcon from "../../../../assets/brand/icons/512/search.png";
import successIcon from "../../../../assets/brand/icons/512/success.png";

const fps = 60;
const holdFrames = fps * 3;

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
  easing: Easing.bezier(0.16, 1, 0.3, 1),
};

const cards = [
  {
    line1: "Agent Skills now guide ClipForge",
    line2: "from clipboard to action",
    eyebrow: "ClipForge",
  },
  {
    line1: "Skills let agents discover and run",
    line2: "safe prompts, tools, and checks.",
    eyebrow: "Local first automation",
  },
  {
    line1: "This video was made in ClipForge",
    line2: "with Remotion skills.",
    eyebrow: "Generated workbench",
  },
];

const cardDuration = (line1: string, line2: string) => line1.length + line2.length + holdFrames + 24;

const card1Duration = 240;
const card2Duration = 270;
const testStart = card1Duration + card2Duration;
const testDuration = 420;
const finalStart = testStart + testDuration;
const finalDuration = 270;
const endStart = finalStart + finalDuration;

const typedLine = (text: string, frame: number, start: number) => {
  return text.slice(0, Math.max(0, Math.min(text.length, Math.floor(frame - start))));
};

const TypeCard = ({
  line1,
  line2,
  eyebrow,
  frame,
}: {
  line1: string;
  line2: string;
  eyebrow: string;
  frame: number;
}) => {
  const line2Start = line1.length + 10;
  const doneFrame = line2Start + line2.length;
  const cursorVisible = Math.floor(frame / 18) % 2 === 0 && frame < doneFrame + holdFrames;
  const lockup = interpolate(frame, [doneFrame, doneFrame + 42], [0, 1], clamp);

  return (
    <AbsoluteFill className="agent-scene title-card">
      <div className="agent-noise" />
      <div
        className="cursor-bar"
        style={{
          scale: `1 ${interpolate(frame, [0, 42], [0, 1], clamp)}`,
        }}
      />
      <div className="title-brand">
        <Img src={logo} />
        <span>{eyebrow}</span>
      </div>
      <main className="typing-wrap">
        <h1>
          <span>
            {typedLine(line1, frame, 0)}
            {frame < line1.length && cursorVisible ? <i /> : null}
          </span>
          <span className="line-two">
            {typedLine(line2, frame, line2Start)}
            {frame >= line2Start && cursorVisible ? <i /> : null}
          </span>
        </h1>
      </main>
      <div
        className="title-hold-mark"
        style={{
          opacity: lockup,
          translate: `0 ${interpolate(frame, [doneFrame, doneFrame + 42], [24, 0], clamp)}px`,
        }}
      >
        <span>60fps Remotion workbench</span>
        <strong>ClipForge</strong>
      </div>
    </AbsoluteFill>
  );
};

const terminalRows = [
  { command: "pnpm test:unit", state: "running" },
  { command: "run-unit-checks.mjs", state: "passed" },
  { command: "verify-agent-panel.mjs", state: "passed" },
  { command: "verify-editor-agent-bridge.mjs", state: "passed" },
  { command: "verify-runtime-boundaries.mjs", state: "passed" },
  { command: "clipboard contracts", state: "stable" },
  { command: "agent bridge", state: "ready" },
];

const clipRows = [
  {
    kind: "link",
    title: "OAuth callback endpoint",
    body: "https://app.clipforge.local/auth/callback",
    time: "now",
  },
  {
    kind: "note",
    title: "Release checklist",
    body: "build, smoke test, sign, checksum, publish",
    time: "2m",
  },
  {
    kind: "code",
    title: "Tauri command",
    body: "invoke(\"capture_current_clipboard\")",
    time: "5m",
  },
  {
    kind: "agent",
    title: "Agent summary",
    body: "3 useful clips found for the current task",
    time: "8m",
  },
];

const FloatingPanelPreview = ({ frame }: { frame: number }) => {
  const active = Math.min(clipRows.length - 1, Math.floor(interpolate(frame, [40, 250], [0, clipRows.length], clamp)));

  return (
    <section
      className="floating-panel-preview"
      style={{
        opacity: interpolate(frame, [0, 30], [0, 1], clamp),
        translate: `0 ${interpolate(frame, [0, 42], [34, 0], clamp)}px`,
      }}
    >
      <header>
        <div>
          <Img src={appIcon} />
          <strong>ClipForge</strong>
        </div>
        <span>Control + V</span>
      </header>
      <div className="panel-search">
        <Img src={searchIcon} />
        <span>Search clipboard history</span>
      </div>
      <div className="panel-list">
        {clipRows.map((row, index) => (
          <article className={index === active ? "panel-row selected" : "panel-row"} key={row.title}>
            <div>
              <span>{row.kind}</span>
              <strong>{row.title}</strong>
              <p>{row.body}</p>
            </div>
            <time>{row.time}</time>
          </article>
        ))}
      </div>
      <footer>
        <span>Enter copy</span>
        <span>Cmd+J details</span>
        <span>Esc close</span>
      </footer>
    </section>
  );
};

const ShortcutHints = ({ frame }: { frame: number }) => {
  const local = Math.max(0, frame - 236);
  const hints = [
    { keys: ["Control", "V"], label: "open panel" },
    { keys: ["Command", "J"], label: "details" },
    { keys: ["Esc"], label: "close" },
  ];

  return (
    <div className="shortcut-hints">
      {hints.map((hint, index) => (
        <div
          className="shortcut-hint"
          key={hint.label}
          style={{
            opacity: interpolate(local - index * 18, [0, 24], [0, 1], clamp),
            translate: `0 ${interpolate(local - index * 18, [0, 24], [18, 0], clamp)}px`,
          }}
        >
          <span>
            {hint.keys.map((key) => (
              <kbd key={key}>{key}</kbd>
            ))}
          </span>
          <strong>{hint.label}</strong>
        </div>
      ))}
    </div>
  );
};

const TestRun = ({ frame }: { frame: number }) => {
  const zoom = interpolate(frame, [120, 390], [1, 1.25], {
    ...clamp,
    easing: Easing.bezier(0.18, 0.88, 0.25, 1),
  });
  const reveal = Math.floor(interpolate(frame, [12, 210], [0, terminalRows.length], clamp));
  const pulse = interpolate(frame % 60, [0, 30, 60], [0.35, 1, 0.35], clamp);

  return (
    <AbsoluteFill className="agent-scene test-scene">
      <div
        className="test-stage"
        style={{
          scale: zoom,
          transformOrigin: "0 0",
        }}
      >
        <header className="test-topbar">
          <Img src={logo} />
          <div>
            <span>integration checks</span>
            <strong>normal run preview</strong>
          </div>
        </header>
        <section className="terminal-window">
          <div className="terminal-toolbar">
            <span />
            <span />
            <span />
            <strong>clipforge/main</strong>
          </div>
          <div className="terminal-body">
            {terminalRows.map((row, index) => (
              <div
                className={index <= reveal ? "terminal-row visible" : "terminal-row"}
                key={row.command}
              >
                <span className="prompt">$</span>
                <code>{row.command}</code>
                <b>{row.state}</b>
              </div>
            ))}
          </div>
        </section>
        <FloatingPanelPreview frame={frame} />
        <aside className="keyframes-panel">
          <div style={{ opacity: pulse }} />
          <span>keyframes</span>
          <strong>panel, keys, tests</strong>
        </aside>
        <ShortcutHints frame={frame} />
      </div>
    </AbsoluteFill>
  );
};

const EndAnimation = ({ frame }: { frame: number }) => {
  const icons = [agentIcon, searchIcon, copyIcon, successIcon];
  return (
    <AbsoluteFill className="agent-scene end-scene">
      <div className="end-ring" style={{ scale: interpolate(frame, [0, 140], [0.72, 1.22], clamp) }} />
      <Img
        className="end-app-icon"
        src={appIcon}
        style={{
          opacity: interpolate(frame, [0, 38], [0, 1], clamp),
          scale: interpolate(frame, [0, 70], [0.82, 1], clamp),
        }}
      />
      <div className="end-icon-orbit">
        {icons.map((icon, index) => (
          <Img
            key={icon}
            src={icon}
            style={{
              opacity: interpolate(frame, [index * 14, index * 14 + 24], [0, 1], clamp),
              translate: `${Math.cos((index / icons.length) * Math.PI * 2) * 330}px ${
                Math.sin((index / icons.length) * Math.PI * 2) * 188
              }px`,
              scale: interpolate(frame, [index * 14, index * 14 + 24], [0.72, 1], clamp),
            }}
          />
        ))}
      </div>
      <div className="end-copy">
        <Img src={logo} />
        <span>Skills for fast clipboard workflows</span>
      </div>
    </AbsoluteFill>
  );
};

export const AgentSkillsClipForge = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill className="agent-root">
      <Sequence from={0} durationInFrames={card1Duration}>
        <TypeCard {...cards[0]} frame={frame} />
      </Sequence>
      <Sequence from={card1Duration} durationInFrames={card2Duration}>
        <TypeCard {...cards[1]} frame={frame - card1Duration} />
      </Sequence>
      <Sequence from={testStart} durationInFrames={testDuration}>
        <TestRun frame={frame - testStart} />
      </Sequence>
      <Sequence from={finalStart} durationInFrames={finalDuration}>
        <TypeCard {...cards[2]} frame={frame - finalStart} />
      </Sequence>
      <Sequence from={endStart} durationInFrames={180}>
        <EndAnimation frame={frame - endStart} />
      </Sequence>
    </AbsoluteFill>
  );
};
