import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  useCurrentFrame,
} from "remotion";
import logo from "../../../../assets/brand/clipforge-logo-horizontal.png";
import appScreen from "../../../../.codex-screenshots/clipforge-screen.png";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
  easing: Easing.bezier(0.16, 1, 0.3, 1),
};

const steps = [
  { title: "唤起面板", body: "用快捷键打开历史记录。" },
  { title: "输入关键词", body: "直接筛选文本、链接和片段。" },
  { title: "回写剪贴板", body: "选中结果后继续粘贴。" },
  { title: "整理长期内容", body: "收藏、归档、删除都在同一处。" },
];

export const OnboardingGuide = () => {
  const frame = useCurrentFrame();
  const stepIndex = Math.min(steps.length - 1, Math.floor(frame / 72));
  const activeStep = steps[stepIndex];
  const progress = interpolate(frame, [0, 300], [0, 1], clamp);

  return (
    <AbsoluteFill className="scene scene-onboarding">
      <header className="guide-header">
        <Img
          className="guide-logo"
          src={logo}
          style={{
            opacity: interpolate(frame, [0, 24], [0, 1], clamp),
            translate: `0 ${interpolate(frame, [0, 24], [-20, 0], clamp)}px`,
          }}
        />
        <div className="progress-track">
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </header>

      <main className="guide-main">
        <div
          className="phone-frame"
          style={{
            opacity: interpolate(frame, [10, 44], [0, 1], clamp),
            translate: `0 ${interpolate(frame, [10, 44], [72, 0], clamp)}px`,
          }}
        >
          <Img className="phone-shot" src={appScreen} />
          <div
            className="focus-window"
            style={{
              opacity: interpolate(frame, [42, 70], [0, 1], clamp),
              translate: `0 ${interpolate(frame, [0, 288], [0, 430], clamp)}px`,
            }}
          />
        </div>

        <section className="guide-card">
          <span>{`0${stepIndex + 1}`}</span>
          <h2
            key={activeStep.title}
            style={{
              opacity: interpolate(frame % 72, [0, 16], [0, 1], clamp),
              translate: `0 ${interpolate(frame % 72, [0, 16], [22, 0], clamp)}px`,
            }}
          >
            {activeStep.title}
          </h2>
          <p
            key={activeStep.body}
            style={{
              opacity: interpolate(frame % 72, [8, 22], [0, 1], clamp),
              translate: `0 ${interpolate(frame % 72, [8, 22], [16, 0], clamp)}px`,
            }}
          >
            {activeStep.body}
          </p>
        </section>
      </main>

      <footer className="guide-footer">
        {steps.map((step, index) => (
          <div className={index === stepIndex ? "step-dot active" : "step-dot"} key={step.title}>
            <span>{step.title}</span>
          </div>
        ))}
      </footer>
    </AbsoluteFill>
  );
};
