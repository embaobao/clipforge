import { Composition } from "remotion";
import { AgentSkillsClipForge } from "./compositions/AgentSkillsClipForge";
import { FeatureIntro } from "./compositions/FeatureIntro";
import { OnboardingGuide } from "./compositions/OnboardingGuide";
import "./styles.css";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="AgentSkillsClipForge"
        component={AgentSkillsClipForge}
        durationInFrames={1380}
        fps={60}
        width={1920}
        height={1080}
      />
      <Composition
        id="FeatureIntro"
        component={FeatureIntro}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="OnboardingGuide"
        component={OnboardingGuide}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
