import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import logo from "../../../../assets/brand/clipforge-logo-horizontal.png";
import appScreen from "../../../../.codex-screenshots/clipforge-screen-main.png";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
  easing: Easing.bezier(0.16, 1, 0.3, 1),
};

const features = [
  { label: "快速唤起", detail: "Control+V 打开剪贴板面板" },
  { label: "即时搜索", detail: "历史、收藏、片段一起筛选" },
  { label: "复制回写", detail: "选中内容马上回到系统剪贴板" },
];

export const FeatureIntro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = interpolate(frame, [0, fps * 1.2], [0, 1], clamp);
  const screenLift = interpolate(frame, [28, 82], [80, 0], clamp);
  const screenOpacity = interpolate(frame, [18, 48], [0, 1], clamp);
  const finalFocus = interpolate(frame, [188, 224], [0, 1], clamp);

  return (
    <AbsoluteFill className="scene scene-feature">
      <div
        className="backplate"
        style={{
          opacity: interpolate(frame, [0, 36], [0, 1], clamp),
          scale: interpolate(frame, [0, 80], [0.96, 1], clamp),
        }}
      />
      <div className="feature-grid">
        <section className="feature-copy">
          <Img
            className="brand-logo"
            src={logo}
            style={{
              opacity: entrance,
              translate: `${interpolate(frame, [0, 28], [-24, 0], clamp)}px 0`,
            }}
          />
          <h1
            style={{
              opacity: interpolate(frame, [10, 42], [0, 1], clamp),
              translate: `0 ${interpolate(frame, [10, 54], [34, 0], clamp)}px`,
            }}
          >
            复制、搜索、回写
            <span>都更快</span>
          </h1>
          <p
            style={{
              opacity: interpolate(frame, [36, 72], [0, 1], clamp),
              translate: `0 ${interpolate(frame, [36, 72], [20, 0], clamp)}px`,
            }}
          >
            ClipForge 把剪贴板历史变成一个低打扰的快速工作面板。
          </p>
        </section>

        <section
          className="product-frame"
          style={{
            opacity: screenOpacity,
            translate: `0 ${screenLift}px`,
            scale: interpolate(frame, [28, 92], [0.96, 1], clamp),
          }}
        >
          <Img className="product-shot" src={appScreen} />
          <div
            className="scan-line"
            style={{
              translate: `${interpolate(frame, [62, 150], [-620, 620], {
                ...clamp,
                easing: Easing.bezier(0.4, 0, 0.2, 1),
              })}px 0`,
              opacity: interpolate(frame, [54, 70, 146, 162], [0, 1, 1, 0], clamp),
            }}
          />
        </section>
      </div>

      <Sequence from={72} durationInFrames={104} layout="none">
        <div className="feature-rail">
          {features.map((feature, index) => {
            const local = frame - 72 - index * 18;
            return (
              <article
                className="feature-pill"
                key={feature.label}
                style={{
                  opacity: interpolate(local, [0, 18], [0, 1], clamp),
                  translate: `0 ${interpolate(local, [0, 18], [26, 0], clamp)}px`,
                }}
              >
                <strong>{feature.label}</strong>
                <span>{feature.detail}</span>
              </article>
            );
          })}
        </div>
      </Sequence>

      <div
        className="final-lockup"
        style={{
          opacity: finalFocus,
          scale: interpolate(frame, [188, 224], [0.98, 1], clamp),
        }}
      >
        <span>快速剪贴板工具</span>
        <strong>少打断，多完成</strong>
      </div>
    </AbsoluteFill>
  );
};
