#pragma once
#include "animation/AnimationPlayer.h"
#include "display/Display.h"
#include "generated/SolflameFrames.h"
#include "animation/BehaviorMotion.h"

namespace tamassol {
class Mascot {
 public:
  explicit Mascot(Display& display) : display_(display) {}
  void setAnimation(AnimationId id);
  void update();
  bool draw();
  void startCelebration(uint32_t now);
  void stopCelebration();
  void setActivity(PetActivity activity,uint32_t now);
  float targetFps() const;
  AnimationId animation() const { return player_.animation(); }
  static uint16_t frameDurationMs(AnimationId id);
 private:
  Display& display_;
  AnimationPlayer player_;
  const assets::FrameSet* frames_ = nullptr;
  bool dirty_ = true;
  bool celebrating_ = false;
  uint32_t celebrationStart_=0;
  uint32_t effectFrame_=UINT32_MAX;
  uint32_t blinkClock_=0, blinkInterval_=4300;
  bool blink_=false;
  PetActivity activity_=PetActivity::Rest;
  uint32_t activityAt_=0,gestureAt_=0,gestureWait_=5500,renderAt_=0;
  uint8_t gestureVariant_=0,celebrationVariant_=1;
  bool gestureActive_=false;
  IdlePose pose_{};
};
} // namespace tamassol

