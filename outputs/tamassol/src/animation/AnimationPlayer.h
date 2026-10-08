#pragma once

#include "Animation.h"

namespace tamassol {

// Pure timing core; caller supplies millis() or an equivalent uint32 clock.
class AnimationPlayer {
 public:
  void start(AnimationId id, uint16_t frameCount, uint16_t frameMs,
             uint32_t now);
  // True when at least one frame interval elapsed, even after a full cycle.
  bool update(uint32_t now);
  uint16_t frame() const { return frame_; }
  AnimationId animation() const { return animation_; }

 private:
  AnimationId animation_ = AnimationId::Sleep;
  uint16_t frameCount_ = 1;
  uint16_t frameMs_ = 1;
  uint16_t frame_ = 0;
  uint32_t lastFrameAt_ = 0;
};

}  // namespace tamassol
