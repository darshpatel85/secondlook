import { Composition } from "remotion";
import { FPS, TOTAL_FRAMES, Video } from "./Video";

export function Root() {
  return <Composition id="SecondLook" component={Video} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />;
}
