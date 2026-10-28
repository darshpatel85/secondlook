import { Audio, Sequence, staticFile } from "remotion";
import { Features } from "./scenes/Features";
import { Intro } from "./scenes/Intro";
import { Outro } from "./scenes/Outro";
import { Problem } from "./scenes/Problem";
import { StepIntent } from "./scenes/StepIntent";
import { StepPaste } from "./scenes/StepPaste";
import { StepPost } from "./scenes/StepPost";
import { StepReview } from "./scenes/StepReview";

export const FPS = 30;

const scenes = [
  { name: "intro", frames: 150, voiceAt: 30, el: <Intro /> },
  { name: "problem", frames: 240, voiceAt: 12, el: <Problem /> },
  { name: "paste", frames: 240, voiceAt: 15, el: <StepPaste /> },
  { name: "intent", frames: 270, voiceAt: 15, el: <StepIntent /> },
  { name: "review", frames: 330, voiceAt: 15, el: <StepReview /> },
  { name: "post", frames: 240, voiceAt: 8, el: <StepPost /> },
  { name: "features", frames: 240, voiceAt: 6, el: <Features /> },
  { name: "outro", frames: 90, voiceAt: 10, el: <Outro /> },
];

export const TOTAL_FRAMES = scenes.reduce((sum, scene) => sum + scene.frames, 0);

export function Video() {
  let from = 0;
  return (
    <>
      {scenes.map((scene) => {
        const node = (
          <Sequence key={scene.name} name={scene.name} from={from} durationInFrames={scene.frames}>
            {scene.el}
            <Sequence from={scene.voiceAt} name={`voice:${scene.name}`}>
              <Audio src={staticFile(`voice/${scene.name}.mp3`)} volume={1} />
            </Sequence>
          </Sequence>
        );
        from += scene.frames;
        return node;
      })}
    </>
  );
}
